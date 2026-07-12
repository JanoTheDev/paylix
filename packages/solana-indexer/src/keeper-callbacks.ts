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
import { fetchSubscriptionAccount, subscriptionPda } from "./subscription-account";
import type { SolanaDueSubscription } from "./keeper";

const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
const FAILURE_THRESHOLD = 3;

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
      );

    const due: SolanaDueSubscription[] = [];
    for (const sub of candidates) {
      if (!sub.contractAddress || !sub.onChainId) continue;
      const programId = new PublicKey(sub.contractAddress);
      const pda = subscriptionPda(programId, BigInt(sub.onChainId));

      const onChain = await fetchSubscriptionAccount(connection, pda);
      if (!onChain || onChain.status !== 0) continue; // not Active on-chain
      const nowSec = BigInt(Math.floor(now.getTime() / 1000));
      if (onChain.nextChargeAt > nowSec) continue; // not due on-chain yet

      const mint = new PublicKey(onChain.mint);
      const subscriberAta = await getAssociatedTokenAddress(mint, new PublicKey(onChain.subscriber));
      const platformAta = await getAssociatedTokenAddress(mint, platformWallet);

      due.push({
        subscriptionPda: pda,
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
    await db
      .update(subscriptions)
      .set({ lastChargeAttemptAt: new Date() })
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
