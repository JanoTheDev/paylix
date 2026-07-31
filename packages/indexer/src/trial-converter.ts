import type { PendingPermitSignature } from "@paylix/db/schema";
import { classifyTrialConversionError, isTerminal, type TrialConversionError } from "./trial-error-classifier";

export const MAX_TRIAL_CONVERSION_ATTEMPTS = 5;

// Field order MUST match SubscriptionManager.CreateSubPermitParams exactly
// (packages/contracts/src/SubscriptionManager.sol:309 and the regenerated
// packages/contracts/abi/SubscriptionManager.json). `maxFeeBps` sits between
// `permitValue` and `deadline`; it is also part of the SubscriptionIntent
// digest the buyer signs (typehash at SubscriptionManager.sol:37), so getting
// the position wrong produces a signature that cannot verify.
//
// `flow` appears in the typehash but NOT in the call params: the contract
// substitutes FLOW_EIP2612 for this entrypoint.
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
          { name: "maxFeeBps", type: "uint256" },
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

/** SubscriptionManager.FLOW_EIP2612 — the flow this entrypoint binds. */
export const FLOW_EIP2612 = 1;

/**
 * Extra fields the relay must capture alongside the buyer's SubscriptionIntent
 * signature after the backup-payer-consent release. They are not in
 * `PendingPermitSignature` yet (see audit/_requests-indexer-evm.md), so they are
 * read defensively: a stored intent WITHOUT `maxFeeBps` is one the buyer signed
 * under the previous typehash.
 */
type StoredIntent = TrialRow extends { pendingPermitSignature: infer S }
  ? S extends { intent: infer I }
    ? I & { maxFeeBps?: string | number | null; flow?: number | null }
    : never
  : never;

export type IntentCompatibility =
  | { replayable: true; maxFeeBps: bigint }
  | { replayable: false; detail: string };

/**
 * Decides whether a stored SubscriptionIntent signature can still be replayed.
 *
 * Re-signing is impossible without the buyer present, so a signature that
 * predates the intent-struct change is dead: it commits to the old typehash and
 * can never verify against the deployed contract. We must detect that from the
 * stored row rather than discovering it as a wave of failed conversions.
 *
 * Two provable signals, both from data the row already holds:
 *  1. No `maxFeeBps` in the stored intent — the buyer never signed the field,
 *     so the new digest cannot be reconstructed at all.
 *  2. The row's `contract_address` is not the SubscriptionManager we submit to
 *     for that network. The signature's EIP-712 domain names that old address;
 *     replaying it anywhere else cannot verify.
 * Plus a guard for an intent signed for a different settlement flow.
 */
export function checkIntentCompatibility(
  row: TrialRow,
  configuredManager: string | null | undefined,
): IntentCompatibility {
  const intent = row.pendingPermitSignature?.intent as StoredIntent | undefined;
  if (!intent) return { replayable: false, detail: "no stored intent signature" };

  if (intent.maxFeeBps === undefined || intent.maxFeeBps === null) {
    // Two independent reasons this is unrecoverable, both worth stating so
    // nobody attempts a salvage migration:
    //   1. The signature commits to the previous SubscriptionIntent typehash
    //      (no maxFeeBps, no flow), so it cannot verify against the deployed
    //      contract whatever we pass.
    //   2. The fee ceiling the buyer actually agreed to was never persisted, so
    //      the digest cannot be reconstructed even in principle. Substituting
    //      the current platformFee() would fail verification AND defeat the
    //      point of the per-subscription ceiling (SC-03).
    return {
      replayable: false,
      detail:
        "intent was signed before SubscriptionIntent gained maxFeeBps/flow, and the " +
        "signed fee ceiling was never stored, so the digest cannot be reconstructed; " +
        "the buyer must re-authorise the subscription from checkout",
    };
  }

  if (intent.flow !== undefined && intent.flow !== null && intent.flow !== FLOW_EIP2612) {
    return {
      replayable: false,
      detail: `intent was signed for settlement flow ${intent.flow}, not the EIP-2612 flow this entrypoint binds`,
    };
  }

  const rowManager = row.contractAddress?.toLowerCase() ?? "";
  if (configuredManager && rowManager && rowManager !== configuredManager.toLowerCase()) {
    return {
      replayable: false,
      detail:
        `intent was signed against retired SubscriptionManager ${rowManager}; ` +
        `current deployment is ${configuredManager.toLowerCase()}`,
    };
  }

  let maxFeeBps: bigint;
  try {
    maxFeeBps = BigInt(intent.maxFeeBps);
  } catch {
    return {
      replayable: false,
      detail: `stored maxFeeBps ${String(intent.maxFeeBps)} is not an integer`,
    };
  }

  return { replayable: true, maxFeeBps };
}

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
    nonce?: number;
  }) => Promise<`0x${string}`>;
  /**
   * Waits for the submitted transaction to land. Must reject or return a
   * non-"success" status for a reverted transaction — writeContract only tells
   * us the tx reached the mempool, which is not a converted trial.
   */
  waitForReceipt: (
    hash: `0x${string}`,
    contractAddress: `0x${string}`,
  ) => Promise<{ status: "success" | "reverted" }>;
  updateSub: (id: string, patch: Record<string, unknown>) => Promise<void>;
  sendMail: (args: SendMailArgs) => Promise<void>;
  /**
   * Resolves the ERC-20 the permit was signed for. The permit signature is
   * bound to a specific token contract, so this must use the subscription's
   * stored symbol — hardcoding USDC either reverts or moves the wrong asset.
   */
  resolveTokenAddress: (networkKey: string, tokenSymbol: string) => `0x${string}`;
  /**
   * Next relayer nonce to use on the chain that hosts `contractAddress`, or
   * undefined to let the RPC pick. Submissions in one tick share a single
   * relayer account per chain; without explicit nonces, mempool lag produces
   * "nonce too low"/replacement errors that the classifier reads as terminal
   * nonce_drift and permanently fails otherwise-valid trials.
   *
   * MUST be per chain: nonces are account+chain scoped, so feeding a Base nonce
   * to an Arbitrum submission produces a transaction that can never mine.
   */
  nextNonce?: (contractAddress: `0x${string}`) => Promise<number | undefined>;
  /**
   * Currently configured SubscriptionManager for the row's network, lowercased.
   * Used to detect intents signed against a retired deployment.
   */
  configuredManagerFor?: (networkKey: string) => string | null;
  /**
   * Called once per tick with every trial whose stored signature can never be
   * replayed, so an operator sees "N trials require re-authorisation" instead of
   * N separate conversion failures.
   */
  reportReauthorizationRequired?: (
    rows: Array<{ id: string; detail: string }>,
  ) => Promise<void>;
};

export async function convertExpiredTrials(
  deps: TrialConverterDeps,
): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  needsReauthorization: number;
}> {
  const {
    rows,
    writeContract,
    waitForReceipt,
    updateSub,
    sendMail,
    resolveTokenAddress,
    nextNonce,
    configuredManagerFor,
    reportReauthorizationRequired,
  } = deps;
  let succeeded = 0;
  let failed = 0;
  const needsReauthorization: Array<{ id: string; detail: string }> = [];

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

    // Cutover guard. A stored signature that cannot verify must NOT be
    // submitted: burning five attempts against it costs relayer gas, hides the
    // real cause behind a generic revert, and buries the row in the same
    // trial_conversion_failed bucket as recoverable failures. Re-signing needs
    // the buyer, so this is terminal — but it is terminal with a distinct
    // reason, an alert, and a count.
    const compatibility = checkIntentCompatibility(
      row,
      configuredManagerFor?.(row.pendingPermitSignature.priceSnapshot.networkKey),
    );
    if (!compatibility.replayable) {
      console.error(
        `[TrialConverter] ${row.id} needs re-authorisation: ${compatibility.detail}`,
      );
      await updateSub(row.id, {
        status: "trial_conversion_failed",
        // Park at the ceiling so no later pass re-selects and re-submits it.
        trialConversionAttempts: MAX_TRIAL_CONVERSION_ATTEMPTS,
        trialConversionLastError:
          `intent_schema_outdated: ${compatibility.detail}`.slice(0, 500),
      });
      await sendMail({
        template: "trial-conversion-failed",
        subscriptionId: row.id,
        reason: "intent_schema_outdated",
      });
      needsReauthorization.push({ id: row.id, detail: compatibility.detail });
      continue;
    }

    const sig = row.pendingPermitSignature;
    try {
      const contractAddress = row.contractAddress as `0x${string}`;
      const txHash = await writeContract({
        address: contractAddress,
        abi: SUBSCRIPTION_MANAGER_ABI,
        functionName: "createSubscriptionWithPermit",
        nonce: nextNonce ? await nextNonce(contractAddress) : undefined,
        args: [
          {
            token: resolveTokenAddress(
              sig.priceSnapshot.networkKey,
              sig.priceSnapshot.tokenSymbol,
            ),
            buyer: row.subscriberAddress as `0x${string}`,
            merchant: sig.intent.merchantId as `0x${string}`,
            amount: BigInt(sig.intent.amount),
            interval: BigInt(sig.intent.interval),
            productId: sig.intent.productIdBytes,
            customerId: sig.intent.customerIdBytes,
            permitValue: BigInt(sig.permit.value),
            // Fee ceiling the buyer signed. Part of the intent digest, and
            // stored per subscription so a later fee raise cannot reprice a
            // live subscription.
            maxFeeBps: compatibility.maxFeeBps,
            deadline: BigInt(sig.permit.deadline),
            v: sig.permit.v,
            r: sig.permit.r,
            s: sig.permit.s,
          },
          sig.intent.signature,
        ],
      });

      // Stamp the submission BEFORE waiting for the receipt. This is what the
      // ten-minute reselection window keys off, and a submitted-but-unconfirmed
      // transaction must be covered by it: if the receipt RPC flakes and the
      // next tick resubmits, the first transaction can still land while the
      // second reverts with IntentAlreadyUsed — classified terminal, row flipped
      // to trial_conversion_failed, and the SubscriptionCreated event for the
      // landed transaction then has no `trialing` row to match. The buyer would
      // be charged on-chain with no payment row.
      await updateSub(row.id, {
        trialConversionSubmittedAt: new Date(),
      });

      // Submission is not conversion. Without the receipt check a reverted
      // transaction takes the success path: attempts are never incremented, so
      // the ten-minute reselection window resubmits the row forever and it
      // never reaches trial_conversion_failed.
      const receipt = await waitForReceipt(txHash, contractAddress);
      if (receipt.status !== "success") {
        throw new Error(
          `createSubscriptionWithPermit reverted on-chain (tx ${txHash})`,
        );
      }

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

  if (needsReauthorization.length > 0) {
    console.error(
      `[TrialConverter] ${needsReauthorization.length} trial(s) require re-authorisation — ` +
        `their stored subscription intents predate the current SubscriptionIntent ` +
        `schema and can never verify. These are NOT recoverable by any migration: ` +
        `the signatures commit to the old typehash, and the fee ceiling they were ` +
        `signed with was never persisted, so the digest cannot be rebuilt. Each buyer ` +
        `has to subscribe again from checkout. Affected subscriptions: ` +
        `${needsReauthorization.map((r) => r.id).join(", ")}`,
    );
    if (reportReauthorizationRequired) {
      try {
        await reportReauthorizationRequired(needsReauthorization);
      } catch (err) {
        console.error(
          "[TrialConverter] Failed to report re-authorisation backlog:",
          err,
        );
      }
    }
  }

  return {
    attempted: rows.length,
    succeeded,
    failed,
    needsReauthorization: needsReauthorization.length,
  };
}

// ---- Integration entrypoint ----
//
// The runtime-dependent imports (config, viem, db, @paylix/config/networks)
// are loaded lazily inside runTrialConverterTick so that importing this module
// from a unit test does not eagerly evaluate config.ts (which requires
// NEXT_PUBLIC_NETWORK at import time).

export async function runTrialConverterTick() {
  const { createPublicClient, createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { createDb } = await import("@paylix/db/client");
  const { subscriptions } = await import("@paylix/db/schema");
  const { and, eq, lte, lt, isNull, or } = await import("drizzle-orm");
  const { NETWORKS, getToken } = await import("@paylix/config/networks");
  type NetworkKey = import("@paylix/config/networks").NetworkKey;
  const { config, deployments } = await import("./config");

  /**
   * Resolves the token the buyer's permit was signed against. Using the stored
   * symbol (not a hardcoded "USDC") is what keeps a trial priced in USDT or
   * PYUSD from being submitted with the USDC contract.
   */
  function resolveTokenAddressForNetwork(
    networkKey: string,
    tokenSymbol: string,
  ): `0x${string}` {
    if (!(networkKey in NETWORKS)) {
      throw new Error(`Unknown networkKey=${networkKey} on trial subscription`);
    }
    const token = getToken(networkKey as NetworkKey, tokenSymbol);
    if (!token) {
      throw new Error(`Token ${tokenSymbol} is not registered on ${networkKey}`);
    }
    const address =
      token.address ??
      (token.addressEnvVar ? (process.env[token.addressEnvVar] as `0x${string}` | undefined) : undefined);
    if (!address) {
      throw new Error(
        `No ${tokenSymbol} address resolved for networkKey=${networkKey} (addressEnvVar=${token.addressEnvVar ?? "none"})`,
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
  const publicClientByManager = new Map<string, ReturnType<typeof createPublicClient>>();
  for (const d of deployments) {
    const managerKey = d.subscriptionManager.toLowerCase();
    walletClientByManager.set(
      managerKey,
      createWalletClient({ account, chain: d.chain, transport: http(d.rpcUrl) }),
    );
    publicClientByManager.set(
      managerKey,
      createPublicClient({ chain: d.chain, transport: http(d.rpcUrl) }),
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

  // Nonces are account+CHAIN scoped, so one cursor per SubscriptionManager (and
  // therefore per chain). A single shared cursor would send an Arbitrum
  // conversion out with a Base nonce: the transaction never mines, the receipt
  // wait times out, and every trial on that chain eventually fails.
  // Read lazily on first use per chain, and left undefined when the account
  // nonce can't be read — viem then falls back to asking the RPC.
  const nonceByManager = new Map<string, number | undefined>();

  async function nonceFor(contractAddress: `0x${string}`): Promise<number | undefined> {
    const managerKey = contractAddress.toLowerCase();
    if (nonceByManager.has(managerKey)) return nonceByManager.get(managerKey);
    const pc = publicClientByManager.get(managerKey);
    let nonce: number | undefined;
    if (pc) {
      try {
        nonce = await pc.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        });
      } catch (err) {
        console.error(
          `[TrialConverter] Could not read relayer nonce for ${contractAddress}, falling back to RPC-assigned nonces:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    nonceByManager.set(managerKey, nonce);
    return nonce;
  }

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
      // Advance this chain's nonce only once the node accepted the transaction —
      // consuming a nonce for a rejected submission would leave a gap that
      // strands every later transaction from this account on that chain.
      return (wc.writeContract(args as never) as Promise<`0x${string}`>).then(
        (hash) => {
          const current = nonceByManager.get(managerKey);
          if (current !== undefined) nonceByManager.set(managerKey, current + 1);
          return hash;
        },
      );
    },
    waitForReceipt: async (hash, contractAddress) => {
      const pc = publicClientByManager.get(contractAddress.toLowerCase());
      if (!pc) {
        throw new Error(
          `[TrialConverter] No publicClient for contract ${contractAddress} — cannot confirm ${hash}`,
        );
      }
      const receipt = await pc.waitForTransactionReceipt({
        hash,
        timeout: 120_000,
      });
      return { status: receipt.status };
    },
    nextNonce: nonceFor,
    configuredManagerFor: (networkKey) => {
      // Trial rows are per (network, livemode); the manager address is the one
      // the relay stored at signature time. Any deployment on that network with
      // a different manager means the intent's EIP-712 domain is retired.
      const forNetwork = deployments.filter((d) => d.networkKey === networkKey);
      if (forNetwork.length !== 1) return null;
      return forNetwork[0].subscriptionManager.toLowerCase();
    },
    reportReauthorizationRequired: async (affected) => {
      const { dispatchSystemWebhook } = await import("./webhook-dispatch");
      await dispatchSystemWebhook("system.trial_reauthorization_required", {
        count: affected.length,
        reason: "subscription_intent_schema_changed",
        subscriptionIds: affected.slice(0, 100).map((r) => r.id),
        detail: affected[0]?.detail ?? null,
      });
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
    resolveTokenAddress: resolveTokenAddressForNetwork,
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
  const { dispatchWebhooks } = await import("./webhook-dispatch");

  const db = createDb(config.databaseUrl);
  const now = new Date();
  const threshold = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: subscriptions.id,
      organizationId: subscriptions.organizationId,
      customerId: subscriptions.customerId,
      productId: subscriptions.productId,
      subscriberAddress: subscriptions.subscriberAddress,
      trialEndsAt: subscriptions.trialEndsAt,
      metadata: subscriptions.metadata,
      livemode: subscriptions.livemode,
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
      await dispatchWebhooks(
        row.organizationId,
        "subscription.trial_ending",
        {
          subscriptionId: row.id,
          productId: row.productId,
          customerId: row.customerId,
          subscriberAddress: row.subscriberAddress,
          trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
          metadata: row.metadata ?? {},
        },
        row.livemode,
      ).catch((err) =>
        console.error("[TrialReminder] webhook failed for", row.id, err),
      );
    } catch (err) {
      console.error("[TrialReminder] failed for", row.id, err);
    }
  }

  return { scanned: rows.length };
}

/**
 * Sends the trial-started welcome email for trialing subscriptions that
 * don't yet have `trial_started_email_sent_at` stamped. Runs alongside the
 * other trial ticks so the email fires within ~30s of the relay call.
 */
export async function runTrialStartedEmailTick(): Promise<{ scanned: number }> {
  const { createDb } = await import("@paylix/db/client");
  const { subscriptions } = await import("@paylix/db/schema");
  const { and, eq, isNull } = await import("drizzle-orm");
  const { config } = await import("./config");

  const db = createDb(config.databaseUrl);

  const rows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "trialing"),
        isNull(subscriptions.trialStartedEmailSentAt),
      ),
    )
    .limit(50);

  for (const row of rows) {
    try {
      const { sendTrialEmail } = await import("./emails/send-trial-email");
      await sendTrialEmail({ kind: "trial-started", subscriptionId: row.id });
      await db
        .update(subscriptions)
        .set({ trialStartedEmailSentAt: new Date() })
        .where(eq(subscriptions.id, row.id));
    } catch (err) {
      console.error("[TrialStartedEmail] failed for", row.id, err);
    }
  }

  return { scanned: rows.length };
}
