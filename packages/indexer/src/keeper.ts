import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createDb } from "@paylix/db/client";
import { subscriptions } from "@paylix/db/schema";
import { eq, lte, and } from "drizzle-orm";
import { config, deployments } from "./config";
import type { Deployment } from "@paylix/config/deployments";
import {
  classifyDunningOutcome,
  computeNextRetryAt,
  RETRY_SCHEDULE_HOURS,
  MAX_PAST_DUE_DAYS,
} from "./dunning";
import { sendSubscriptionEmail } from "./emails/send-subscription-email";
import { dispatchWebhooks } from "./webhook-dispatch";

const DEFAULT_INTERVAL_SECONDS = 30 * 24 * 60 * 60; // 30 days fallback

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
    );

  console.log(`[Keeper] Found ${dueSubscriptions.length} subscriptions due for charge`);

  for (const sub of dueSubscriptions) {
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
        const { dispatchWebhooks } = await import("./webhook-dispatch");
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

    // Optimistically bump nextChargeDate BEFORE sending the tx to prevent the
    // next keeper tick from reselecting this subscription if the current
    // attempt is still in-flight. Roll back on failure.
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
      await db
        .update(subscriptions)
        .set({ nextChargeDate: tentativeNext })
        .where(eq(subscriptions.id, sub.id));
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

      const receipt = await route.publicClient.waitForTransactionReceipt({ hash: txHash });

      console.log(`[Keeper] Transaction ${receipt.status}: ${txHash} (block ${receipt.blockNumber})`);

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

      const newFailureCount = (sub.chargeFailureCount ?? 0) + 1;
      const now = new Date();
      const errMsg = error instanceof Error ? error.message : String(error);

      const outcome = classifyDunningOutcome({
        failureCount: newFailureCount,
        hoursPastDue: 0,
      });

      const update: Partial<typeof subscriptions.$inferInsert> = {
        chargeFailureCount: newFailureCount,
        lastChargeError: errMsg,
        lastChargeAttemptAt: now,
      };

      switch (outcome) {
        case "retry":
          update.nextChargeDate = computeNextRetryAt(newFailureCount, now);
          break;
        case "past_due":
          update.status = "past_due";
          update.pastDueSince = now;
          update.nextChargeDate = computeNextRetryAt(RETRY_SCHEDULE_HOURS.length, now);
          break;
        case "cancel":
          // Unreachable with hoursPastDue=0 — Task 11's sweep handles long-past-due auto-cancel.
          console.error(`[Keeper] Unexpected 'cancel' outcome for ${sub.id} with hoursPastDue=0`);
          update.nextChargeDate = computeNextRetryAt(newFailureCount, now);
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
