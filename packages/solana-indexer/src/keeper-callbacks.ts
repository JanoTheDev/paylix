/**
 * Drizzle-backed implementation of the keeper's due-subscription lookup and
 * charge-outcome recording. Mirrors the db-callbacks.ts / writer.ts split:
 * keeper.ts stays DB-agnostic, this file supplies the callbacks.
 *
 * merchant_ata and mint always come from a freshly-fetched on-chain
 * Subscription account (see subscription-account.ts) — never re-derived
 * off-chain, since charge_subscription now rejects any merchant_ata that
 * doesn't match the on-chain-stored value.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { and, eq, lte, or, isNull, lt } from "drizzle-orm";
import type { Database } from "@paylix/db/client";
import { subscriptions } from "@paylix/db/schema";
import { fetchSubscriptionAccounts, subscriptionPda } from "./subscription-account";
import type { SolanaDueSubscription } from "./keeper";

const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
const FAILURE_THRESHOLD = 3;
/**
 * Ceiling on subscriptions considered per tick. Without it a backlog turns
 * every 60-second tick into an unbounded serial RPC storm — see IDX-28.
 * Anything left over is picked up by the next tick.
 */
const MAX_DUE_PER_TICK = 200;

export interface KeeperCallbacksOptions {
  db: Database;
  connection: Connection;
  networkKey: "solana" | "solana-devnet";
  platformWallet: PublicKey;
}

export function makeSolanaKeeperCallbacks(opts: KeeperCallbacksOptions) {
  const { db, connection, networkKey, platformWallet } = opts;

  async function dueSubscriptions(): Promise<SolanaDueSubscription[]> {
    const now = new Date();
    const debounceCutoff = new Date(now.getTime() - DEBOUNCE_MS);

    const candidates = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.networkKey, networkKey),
          eq(subscriptions.status, "active"),
          lte(subscriptions.nextChargeDate, now),
          or(isNull(subscriptions.lastChargeAttemptAt), lt(subscriptions.lastChargeAttemptAt, debounceCutoff)),
        ),
      )
      .orderBy(subscriptions.nextChargeDate)
      .limit(MAX_DUE_PER_TICK);

    const addressable = candidates
      .filter((sub) => sub.contractAddress && sub.onChainId)
      .map((sub) => ({
        programId: new PublicKey(sub.contractAddress),
        pda: subscriptionPda(new PublicKey(sub.contractAddress), BigInt(sub.onChainId!)),
      }));

    // One batched RPC round trip per 100 candidates instead of one per row.
    const accounts = await fetchSubscriptionAccounts(
      connection,
      addressable.map((a) => a.pda),
    );

    const nowSec = BigInt(Math.floor(now.getTime() / 1000));
    const due: SolanaDueSubscription[] = [];
    for (let i = 0; i < addressable.length; i++) {
      const onChain = accounts[i];
      if (!onChain || onChain.status !== 0) continue; // not Active on-chain
      if (onChain.nextChargeAt > nowSec) continue; // not due on-chain yet

      const mint = new PublicKey(onChain.mint);
      const subscriberAta = await getAssociatedTokenAddress(mint, new PublicKey(onChain.subscriber));
      const platformAta = await getAssociatedTokenAddress(mint, platformWallet);

      due.push({
        subscriptionPda: addressable[i].pda,
        subscriptionId: onChain.id,
        subscriberAta,
        merchantAta: new PublicKey(onChain.merchantAta),
        platformAta,
        mint,
      });
    }
    return due;
  }

  async function onChargeSubmitted(subscriptionId: bigint): Promise<void> {
    // Reset the dunning state on success. Without this the failure counter is
    // cumulative for the lifetime of the subscription, so a single failure
    // years later trips FAILURE_THRESHOLD immediately — see IDX-28.
    await db
      .update(subscriptions)
      .set({
        lastChargeAttemptAt: new Date(),
        chargeFailureCount: 0,
        lastChargeError: null,
        pastDueSince: null,
      })
      .where(and(eq(subscriptions.networkKey, networkKey), eq(subscriptions.onChainId, subscriptionId.toString())));
  }

  async function onChargeFailed(subscriptionId: bigint, error: string): Promise<void> {
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.networkKey, networkKey), eq(subscriptions.onChainId, subscriptionId.toString())))
      .limit(1);
    if (!sub) return;

    const newFailureCount = (sub.chargeFailureCount ?? 0) + 1;
    const update: Partial<typeof subscriptions.$inferInsert> = {
      chargeFailureCount: newFailureCount,
      lastChargeError: error,
      lastChargeAttemptAt: new Date(),
    };
    if (newFailureCount >= FAILURE_THRESHOLD) {
      update.status = "past_due";
      update.pastDueSince = sub.pastDueSince ?? new Date();
    }
    await db.update(subscriptions).set(update).where(eq(subscriptions.id, sub.id));
  }

  return { dueSubscriptions, onChargeSubmitted, onChargeFailed };
}
