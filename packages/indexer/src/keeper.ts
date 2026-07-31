import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createDb } from "@paylix/db/client";
import { subscriptions } from "@paylix/db/schema";
import { eq, lte, and, isNull } from "drizzle-orm";
import { config, deployments, parsePositiveIntEnv } from "./config";
import type { Deployment } from "@paylix/config/deployments";
import {
  classifyDunningOutcome,
  computeNextRetryAt,
  RETRY_SCHEDULE_HOURS,
  MAX_PAST_DUE_DAYS,
} from "./dunning";
import { sendSubscriptionEmail } from "./emails/send-subscription-email";
import { dispatchWebhooks } from "./webhook-dispatch";
import { classifyChargeFailure } from "./charge-error";

const DEFAULT_INTERVAL_SECONDS = 30 * 24 * 60 * 60; // 30 days fallback

// Per-transaction receipt wait. Anything longer and one hung RPC call starves
// the rest of the batch and every other keeper-scheduled job.
export const RECEIPT_TIMEOUT_MS = parsePositiveIntEnv(
  "KEEPER_RECEIPT_TIMEOUT_MS",
  120_000,
);
// Cap the rows one tick will attempt; the remainder is picked up next tick.
const KEEPER_BATCH_SIZE = parsePositiveIntEnv("KEEPER_BATCH_SIZE", 100);
// Re-attempt delay for failures on our side (manager paused, RPC trouble).
const TRANSIENT_RETRY_MS = 15 * 60 * 1000;

const chargeSubscriptionAbi = [{
  name: "chargeSubscription",
  type: "function",
  inputs: [{ name: "subscriptionId", type: "uint256" }],
  outputs: [],
  stateMutability: "nonpayable",
}] as const;

type KeeperRoute = {
  deployment: Deployment;
  walletClient: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createPublicClient>;
};

export async function runKeeper() {
  console.log("[Keeper] Running subscription charge check...");

  const db = createDb(config.databaseUrl);
  const account = privateKeyToAccount(config.keeperPrivateKey);

  const routesByManager = new Map<string, KeeperRoute>();
  for (const d of deployments) {
    const walletClient = createWalletClient({
      account,
      chain: d.chain,
      transport: http(d.rpcUrl),
    });
    const publicClient = createPublicClient({
      chain: d.chain,
      transport: http(d.rpcUrl),
    });
    routesByManager.set(d.subscriptionManager.toLowerCase(), {
      deployment: d,
      walletClient,
      publicClient,
    });
  }

  const now = new Date();

  // Query ALL active due subscriptions, regardless of contract address.
  // Each subscription row records the contract it was born on and the keeper
  // routes the writeContract call to that specific address below. This lets
  // the operator redeploy SubscriptionManager (e.g. after an upgrade) without
  // stranding old subscriptions — they keep charging on the old contract.
  const dueSubscriptions = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "active"),
        lte(subscriptions.nextChargeDate, now)
      )
    )
    .limit(KEEPER_BATCH_SIZE);

  console.log(`[Keeper] Found ${dueSubscriptions.length} subscriptions due for charge`);

  for (const sub of dueSubscriptions) {
    // Gift subscriptions never touch the contract. When gift_expires_at
    // passes we flip to cancelled and emit the webhook; otherwise leave
    // the row alone (next_charge_date acts purely as the expiry marker).
    if (sub.isGift) {
      const expiresAt = sub.giftExpiresAt ?? sub.nextChargeDate;
      if (expiresAt && expiresAt.getTime() <= now.getTime()) {
        try {
          await db
            .update(subscriptions)
            .set({ status: "cancelled", nextChargeDate: null })
            .where(eq(subscriptions.id, sub.id));
          await dispatchWebhooks(
            sub.organizationId,
            "subscription.cancelled",
            {
              subscriptionId: sub.id,
              status: "cancelled",
              reason: "gift_expired",
              metadata: sub.metadata ?? {},
            },
            sub.livemode,
          ).catch((err) =>
            console.error("[Keeper] gift-expired webhook failed:", err),
          );
        } catch (err) {
          console.error(`[Keeper] Failed to expire gift ${sub.id}:`, err);
        }
      }
      continue;
    }

    if (!sub.onChainId) {
      console.warn(`[Keeper] Subscription ${sub.id} has no onChainId, skipping`);
      continue;
    }

    // Scheduled cancellation: the period boundary has arrived, flip to
    // cancelled instead of charging. Emit webhook so merchants see the
    // transition exactly once. Off-chain only — keeper is the only party
    // that ever calls chargeSubscription, so skipping here is sufficient.
    if (sub.cancelAtPeriodEnd) {
      try {
        await db
          .update(subscriptions)
          .set({
            status: "cancelled",
            cancelAtPeriodEnd: false,
            nextChargeDate: null,
          })
          .where(eq(subscriptions.id, sub.id));
        await dispatchWebhooks(
          sub.organizationId,
          "subscription.cancelled",
          {
            subscriptionId: sub.id,
            onChainId: sub.onChainId,
            status: "cancelled",
            reason: "scheduled",
            metadata: sub.metadata ?? {},
          },
          sub.livemode,
        ).catch((err) =>
          console.error("[Keeper] scheduled-cancel webhook failed:", err),
        );
        console.log(
          `[Keeper] Subscription ${sub.id} reached cancel_at_period_end boundary, flipped to cancelled`,
        );
      } catch (err) {
        console.error(
          `[Keeper] Failed to flip ${sub.id} to cancelled at period end:`,
          err,
        );
      }
      continue;
    }

    // Claim the row by bumping nextChargeDate BEFORE sending the tx, so the
    // next tick can't reselect a subscription whose charge is still in flight.
    // The bump is conditional on next_charge_date still holding the value we
    // read: if another keeper instance (or an overlapping tick) claimed it
    // first, the UPDATE matches nothing and we skip the row rather than
    // double-charging the subscriber. Rolled back on failure.
    const originalNextChargeDate = sub.nextChargeDate;
    const intervalSeconds =
      (sub.intervalSeconds && sub.intervalSeconds > 0
        ? sub.intervalSeconds
        : null) ?? DEFAULT_INTERVAL_SECONDS;
    const intervalMs = intervalSeconds * 1000;
    const baseTime = originalNextChargeDate
      ? originalNextChargeDate.getTime()
      : now.getTime();
    const tentativeNext = new Date(baseTime + intervalMs);

    try {
      const claimed = await db
        .update(subscriptions)
        .set({ nextChargeDate: tentativeNext })
        .where(
          and(
            eq(subscriptions.id, sub.id),
            originalNextChargeDate
              ? eq(subscriptions.nextChargeDate, originalNextChargeDate)
              : isNull(subscriptions.nextChargeDate),
          ),
        )
        .returning({ id: subscriptions.id });
      if (claimed.length === 0) {
        console.warn(
          `[Keeper] Subscription ${sub.id} was claimed by another keeper pass, skipping`,
        );
        continue;
      }
    } catch (err) {
      console.error(
        `[Keeper] Failed to bump nextChargeDate for ${sub.id}, skipping:`,
        err
      );
      continue;
    }

    try {
      // Subscriptions are locked to the contract they were born on. Read the
      // address from the row, not the env — if the operator redeploys the
      // SubscriptionManager, old subs keep charging on the old contract and new
      // subs go to the new one. See spec §Option Z.
      const contractAddress = sub.contractAddress as `0x${string}` | null;
      if (!contractAddress) {
        console.error(
          `[Keeper] Subscription ${sub.id} has no contract_address, skipping. ` +
            `This should not happen for subs created after the multi-chain refactor.`,
        );
        // Roll back the optimistic bump since we're skipping.
        await db
          .update(subscriptions)
          .set({ nextChargeDate: originalNextChargeDate })
          .where(eq(subscriptions.id, sub.id));
        continue;
      }

      const managerKey = contractAddress.toLowerCase();
      const route = routesByManager.get(managerKey);
      if (!route) {
        console.warn(
          `[Keeper] Subscription ${sub.id} has contract ${contractAddress} not in any configured deployment; skipping`,
        );
        await db
          .update(subscriptions)
          .set({ nextChargeDate: originalNextChargeDate })
          .where(eq(subscriptions.id, sub.id));
        continue;
      }

      console.log(`[Keeper] Charging subscription ${sub.id} (onChainId: ${sub.onChainId}) via contract ${contractAddress}`);

      const txHash = await route.walletClient.writeContract({
        address: contractAddress,
        abi: chargeSubscriptionAbi,
        functionName: "chargeSubscription",
        args: [BigInt(sub.onChainId)],
        chain: route.deployment.chain,
      } as never);

      console.log(`[Keeper] Transaction sent: ${txHash}`);

      // Bounded wait: an unbounded one blocks every remaining subscription in
      // the batch — and, via the keeperRunning guard, the whole background
      // pipeline — on a single stuck transaction.
      const receipt = await route.publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: RECEIPT_TIMEOUT_MS,
      });

      console.log(`[Keeper] Transaction ${receipt.status}: ${txHash} (block ${receipt.blockNumber})`);

      // waitForTransactionReceipt resolves for reverted transactions too.
      // Treating "landed" as "succeeded" would reset the dunning ladder and
      // hand the subscriber a free billing period.
      if (receipt.status !== "success") {
        throw new Error(
          `chargeSubscription reverted on-chain (tx ${txHash}, block ${receipt.blockNumber})`,
        );
      }

      await db
        .update(subscriptions)
        .set({
          chargeFailureCount: 0,
          lastChargeError: null,
          lastChargeAttemptAt: new Date(),
          pastDueSince: null,
        })
        .where(eq(subscriptions.id, sub.id));
    } catch (error) {
      console.error(`[Keeper] Failed to charge subscription ${sub.id}:`, error);

      const now = new Date();
      const errMsg = error instanceof Error ? error.message : String(error);
      const failureKind = classifyChargeFailure(error);

      // A pause on OUR contract, an RPC timeout or a relayer gas problem is not
      // the subscriber's fault — it must not walk them toward past_due.
      const newFailureCount =
        failureKind === "transient"
          ? (sub.chargeFailureCount ?? 0)
          : (sub.chargeFailureCount ?? 0) + 1;

      // Real hours-past-due, not a hardcoded 0 — otherwise the "cancel" arm of
      // the ladder is structurally unreachable and a subscription can only ever
      // leave the retry loop via sweepLongPastDue.
      const hoursPastDue = sub.pastDueSince
        ? Math.max(0, (now.getTime() - sub.pastDueSince.getTime()) / (60 * 60 * 1000))
        : 0;

      let outcome = classifyDunningOutcome({
        failureCount: newFailureCount,
        hoursPastDue,
      });

      if (failureKind === "token_blocked" && outcome === "retry") {
        // The token itself refuses the transfer (blacklisted subscriber, paused
        // or freezing token). Payability is pre-checked on-chain now, so the
        // call reverts inside transferFrom and the contract's own PastDue write
        // is rolled back with it — the keeper is the only escalation path left.
        // Retrying is provably useless and each attempt costs gas plus a receipt
        // wait in this sequential loop, so skip the ladder.
        console.warn(
          `[Keeper] Subscription ${sub.id} failed at the token level; escalating straight to past_due: ${errMsg}`,
        );
        outcome = "past_due";
      } else if (failureKind === "transient") {
        console.warn(
          `[Keeper] Subscription ${sub.id} hit a transient failure; not counting it against the subscriber: ${errMsg}`,
        );
        outcome = "retry";
      }

      const update: Partial<typeof subscriptions.$inferInsert> = {
        chargeFailureCount: newFailureCount,
        lastChargeError: errMsg,
        lastChargeAttemptAt: now,
      };

      switch (outcome) {
        case "retry":
          update.nextChargeDate =
            failureKind === "transient"
              ? // Come back shortly — the condition is on our side and is
                // usually cleared in minutes, not the 24h ladder step.
                new Date(now.getTime() + TRANSIENT_RETRY_MS)
              : computeNextRetryAt(newFailureCount, now);
          break;
        case "past_due":
          update.status = "past_due";
          update.pastDueSince = now;
          update.nextChargeDate = computeNextRetryAt(RETRY_SCHEDULE_HOURS.length, now);
          break;
        case "cancel":
          // Past due beyond MAX_PAST_DUE_DAYS — same terminal state
          // sweepLongPastDue applies, reached here first because we already
          // know this charge failed.
          update.status = "cancelled";
          update.nextChargeDate = null;
          console.log(
            `[Keeper] Subscription ${sub.id} past due for ${Math.round(hoursPastDue)}h, cancelling`,
          );
          break;
        default: {
          const _exhaustive: never = outcome;
          console.error(`[Keeper] Unknown dunning outcome: ${String(_exhaustive)}`);
        }
      }

      let dbWriteOk = false;
      try {
        await db.update(subscriptions).set(update).where(eq(subscriptions.id, sub.id));
        dbWriteOk = true;
      } catch (dbErr) {
        console.error(`[Keeper] Failed to persist dunning update for ${sub.id}:`, dbErr);
      }

      if (dbWriteOk && outcome === "past_due") {
        sendSubscriptionEmail({ kind: "past-due-reminder", subscriptionId: sub.id }).catch(
          (emailErr) =>
            console.error(`[Keeper] Failed to send past-due email for ${sub.id}:`, emailErr),
        );
        // The contract can no longer be relied on to emit SubscriptionPastDue
        // for this: a token-level revert rolls that write back. Dispatch the
        // webhook from here so the merchant still learns about it.
        await dispatchWebhooks(
          sub.organizationId,
          "subscription.past_due",
          {
            subscriptionId: sub.id,
            onChainId: sub.onChainId,
            status: "past_due",
            reason: failureKind === "token_blocked" ? "token_blocked" : "charge_failed",
            lastChargeError: errMsg,
            metadata: sub.metadata ?? {},
          },
          sub.livemode,
        ).catch((webhookErr) =>
          console.error(`[Keeper] past_due webhook failed for ${sub.id}:`, webhookErr),
        );
      }

      if (dbWriteOk && outcome === "cancel") {
        await dispatchWebhooks(
          sub.organizationId,
          "subscription.cancelled",
          {
            subscriptionId: sub.id,
            onChainId: sub.onChainId,
            status: "cancelled",
            reason: "past_due_dunning",
            metadata: sub.metadata ?? {},
          },
          sub.livemode,
        ).catch((webhookErr) =>
          console.error(`[Keeper] dunning-cancel webhook failed for ${sub.id}:`, webhookErr),
        );
      }
    }
  }

  console.log("[Keeper] Charge check complete.");
}

export async function sweepLongPastDue() {
  const db = createDb(config.databaseUrl);
  const cutoff = new Date(Date.now() - MAX_PAST_DUE_DAYS * 24 * 60 * 60 * 1000);

  const cancelled = await db
    .update(subscriptions)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(subscriptions.status, "past_due"),
        lte(subscriptions.pastDueSince, cutoff),
      ),
    )
    .returning({
      id: subscriptions.id,
      organizationId: subscriptions.organizationId,
      onChainId: subscriptions.onChainId,
      metadata: subscriptions.metadata,
      livemode: subscriptions.livemode,
    });

  if (cancelled.length === 0) return 0;

  console.log(`[Keeper] Auto-cancelled ${cancelled.length} long-past-due subscriptions`);

  for (const sub of cancelled) {
    try {
      await dispatchWebhooks(sub.organizationId, "subscription.cancelled", {
        subscriptionId: sub.id,
        onChainId: sub.onChainId,
        status: "cancelled",
        metadata: sub.metadata ?? {},
        cancelReason: "past_due_sweep",
      }, sub.livemode);
    } catch (err) {
      console.error(
        `[Keeper] Failed to dispatch subscription.cancelled webhook for ${sub.id}:`,
        err,
      );
    }
  }

  return cancelled.length;
}
