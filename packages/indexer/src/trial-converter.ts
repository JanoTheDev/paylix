import type { PendingPermitSignature } from "@paylix/db/schema";
import { classifyTrialConversionError, isTerminal, type TrialConversionError } from "./trial-error-classifier";

export const MAX_TRIAL_CONVERSION_ATTEMPTS = 5;

const SUBSCRIPTION_MANAGER_ABI = [
  {
    name: "createSubscriptionWithPermit",
    type: "function",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "buyer", type: "address" },
          { name: "merchant", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "interval", type: "uint256" },
          { name: "productId", type: "bytes32" },
          { name: "customerId", type: "bytes32" },
          { name: "permitValue", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
      { name: "intentSignature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export type TrialRow = {
  id: string;
  subscriberAddress: string;
  contractAddress: string;
  intervalSeconds: number | null;
  trialConversionAttempts: number;
  pendingPermitSignature: PendingPermitSignature | null;
};

export type SendMailArgs = {
  template: "trial-conversion-failed";
  subscriptionId: string;
  reason: TrialConversionError;
};

export type TrialConverterDeps = {
  rows: TrialRow[];
  writeContract: (args: {
    address: `0x${string}`;
    abi: typeof SUBSCRIPTION_MANAGER_ABI;
    functionName: "createSubscriptionWithPermit";
    args: [unknown, `0x${string}`];
  }) => Promise<`0x${string}`>;
  updateSub: (id: string, patch: Record<string, unknown>) => Promise<void>;
  sendMail: (args: SendMailArgs) => Promise<void>;
  resolveUsdcAddress: (networkKey: string) => `0x${string}`;
};

export async function convertExpiredTrials(
  deps: TrialConverterDeps,
): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const { rows, writeContract, updateSub, sendMail, resolveUsdcAddress } = deps;
  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.pendingPermitSignature) {
      await updateSub(row.id, {
        status: "trial_conversion_failed",
        trialConversionLastError: "unknown",
      });
      await sendMail({ template: "trial-conversion-failed", subscriptionId: row.id, reason: "unknown" });
      failed++;
      continue;
    }
    const sig = row.pendingPermitSignature;
    try {
      await writeContract({
        address: row.contractAddress as `0x${string}`,
        abi: SUBSCRIPTION_MANAGER_ABI,
        functionName: "createSubscriptionWithPermit",
        args: [
          {
            token: resolveUsdcAddress(sig.priceSnapshot.networkKey),
            buyer: row.subscriberAddress as `0x${string}`,
            merchant: sig.intent.merchantId as `0x${string}`,
            amount: BigInt(sig.intent.amount),
            interval: BigInt(sig.intent.interval),
            productId: sig.intent.productIdBytes,
            customerId: sig.intent.customerIdBytes,
            permitValue: BigInt(sig.permit.value),
            deadline: BigInt(sig.permit.deadline),
            v: sig.permit.v,
            r: sig.permit.r,
            s: sig.permit.s,
          },
          sig.intent.signature,
        ],
      });
      await updateSub(row.id, {
        trialConversionSubmittedAt: new Date(),
      });
      succeeded++;
      // Do not clear pending_permit_signature here — the SubscriptionCreated
      // handler will do that during match-and-activate (Task 10).
    } catch (err) {
      const category = classifyTrialConversionError(err);
      const rawMessage = err instanceof Error ? err.message : String(err);
      console.error(`[TrialConverter] writeContract reverted for ${row.id} (${category}):`, rawMessage);
      const errorDetail = `${category}: ${rawMessage}`.slice(0, 500);
      const nextAttempts = row.trialConversionAttempts + 1;
      const shouldFail = isTerminal(category) || nextAttempts >= MAX_TRIAL_CONVERSION_ATTEMPTS;
      if (shouldFail) {
        await updateSub(row.id, {
          status: "trial_conversion_failed",
          trialConversionAttempts: nextAttempts,
          trialConversionLastError: errorDetail,
        });
        await sendMail({ template: "trial-conversion-failed", subscriptionId: row.id, reason: category });
        failed++;
      } else {
        await updateSub(row.id, {
          trialConversionAttempts: nextAttempts,
          trialConversionLastError: errorDetail,
        });
      }
    }
  }

  return { attempted: rows.length, succeeded, failed };
}

// ---- Integration entrypoint ----
//
// The runtime-dependent imports (config, viem, db, @paylix/config/networks)
// are loaded lazily inside runTrialConverterTick so that importing this module
// from a unit test does not eagerly evaluate config.ts (which requires
// NEXT_PUBLIC_NETWORK at import time).

export async function runTrialConverterTick() {
  const { createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { createDb } = await import("@paylix/db/client");
  const { subscriptions } = await import("@paylix/db/schema");
  const { and, eq, lte, lt, isNull, or } = await import("drizzle-orm");
  const { getToken } = await import("@paylix/config/networks");
  type NetworkKey = import("@paylix/config/networks").NetworkKey;
  const { config, deployments } = await import("./config");

  function resolveUsdcAddressForNetwork(networkKey: string): `0x${string}` {
    const token = getToken(networkKey as NetworkKey, "USDC");
    const address =
      token.address ??
      (token.addressEnvVar ? (process.env[token.addressEnvVar] as `0x${string}` | undefined) : undefined);
    if (!address) {
      throw new Error(
        `No USDC address resolved for networkKey=${networkKey} (addressEnvVar=${token.addressEnvVar ?? "none"})`,
      );
    }
    return address;
  }

  const db = createDb(config.databaseUrl);
  // createSubscriptionWithPermit is gated by `onlyRelayer` on the contract, so
  // we MUST use the relayer wallet here, not the keeper. The keeper wallet is
  // only whitelisted for chargeSubscription.
  const relayerKey = config.relayerPrivateKey;
  if (!relayerKey) {
    throw new Error(
      "RELAYER_PRIVATE_KEY is required for trial conversion. Set it in the indexer env.",
    );
  }
  const account = privateKeyToAccount(relayerKey);

  const walletClientByManager = new Map<string, ReturnType<typeof createWalletClient>>();
  for (const d of deployments) {
    walletClientByManager.set(
      d.subscriptionManager.toLowerCase(),
      createWalletClient({ account, chain: d.chain, transport: http(d.rpcUrl) }),
    );
  }

  const now = new Date();
  const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
  const rows = await db
    .select({
      id: subscriptions.id,
      subscriberAddress: subscriptions.subscriberAddress,
      contractAddress: subscriptions.contractAddress,
      intervalSeconds: subscriptions.intervalSeconds,
      trialConversionAttempts: subscriptions.trialConversionAttempts,
      pendingPermitSignature: subscriptions.pendingPermitSignature,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "trialing"),
        lte(subscriptions.trialEndsAt, now),
        lt(subscriptions.trialConversionAttempts, MAX_TRIAL_CONVERSION_ATTEMPTS),
        or(
          isNull(subscriptions.trialConversionSubmittedAt),
          lt(subscriptions.trialConversionSubmittedAt, tenMinAgo),
        ),
      ),
    )
    .limit(50);

  return convertExpiredTrials({
    rows: rows as TrialRow[],
    writeContract: (args) => {
      const managerKey = (args.address as string).toLowerCase();
      const wc = walletClientByManager.get(managerKey);
      if (!wc) {
        return Promise.reject(
          new Error(`[TrialConverter] No walletClient for contract ${args.address} — not in any configured deployment`),
        );
      }
      return wc.writeContract(args as never) as Promise<`0x${string}`>;
    },
    updateSub: async (id, patch) => {
      await db.update(subscriptions).set(patch as never).where(eq(subscriptions.id, id));
    },
    sendMail: async (args) => {
      try {
        const { sendTrialEmail } = await import("./emails/send-trial-email");
        await sendTrialEmail({
          kind: "trial-conversion-failed",
          subscriptionId: args.subscriptionId,
          reason: args.reason,
        });
      } catch (err) {
        console.error("[TrialConverter] sendTrialEmail failed:", err);
      }
    },
    resolveUsdcAddress: resolveUsdcAddressForNetwork,
  });
}

/**
 * Sends a "trial ending soon" reminder for trialing subscriptions whose
 * trial_ends_at falls within the next 3 days. Idempotent: each row is only
 * notified once, tracked via `trial_reminder_sent_at`.
 *
 * Runs on the same tick as runTrialConverterTick.
 */
export async function runTrialReminderTick(): Promise<{ scanned: number }> {
  const { createDb } = await import("@paylix/db/client");
  const { subscriptions } = await import("@paylix/db/schema");
  const { and, eq, gt, lte, isNull } = await import("drizzle-orm");
  const { config } = await import("./config");

  const db = createDb(config.databaseUrl);
  const now = new Date();
  const threshold = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: subscriptions.id,
      organizationId: subscriptions.organizationId,
      customerId: subscriptions.customerId,
      trialEndsAt: subscriptions.trialEndsAt,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "trialing"),
        isNull(subscriptions.trialReminderSentAt),
        lte(subscriptions.trialEndsAt, threshold),
        gt(subscriptions.trialEndsAt, now),
      ),
    )
    .limit(50);

  for (const row of rows) {
    try {
      const { sendTrialEmail } = await import("./emails/send-trial-email");
      await sendTrialEmail({
        kind: "trial-ending-soon",
        subscriptionId: row.id,
      });
      await db
        .update(subscriptions)
        .set({ trialReminderSentAt: new Date() })
        .where(eq(subscriptions.id, row.id));
    } catch (err) {
      console.error("[TrialReminder] failed for", row.id, err);
    }
  }

  return { scanned: rows.length };
}
