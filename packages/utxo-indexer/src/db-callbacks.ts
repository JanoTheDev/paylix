/**
 * Drizzle-backed implementations of the utxo-watcher bridge callbacks.
 *
 * Keeps the watcher package DB-agnostic while letting operators still run a
 * one-command indexer process. The bridge calls us; we read/write Postgres
 * via @paylix/db.
 */

import { and, eq, gt, inArray, isNotNull, max, sql } from "drizzle-orm";
import type { BridgeCallbacks, BridgeSessionRow, UtxoChainKey } from "@paylix/utxo-watcher";
import type { AddressPaymentHit } from "@paylix/utxo-watcher";

import { createDb, type Database } from "@paylix/db/client";
import {
  checkoutSessions,
  merchantPayoutWallets,
  payments,
} from "@paylix/db/schema";

export interface UtxoDbCallbacksOptions {
  /** Network key this callback set covers — one chain × one env. */
  networkKey: UtxoChainKey;
  /** Drizzle database handle. Pass in so tests can use an in-memory fake. */
  db: Database;
}

export function makeUtxoDbCallbacks(opts: UtxoDbCallbacksOptions): BridgeCallbacks {
  const db = opts.db;
  const { networkKey } = opts;

  return {
    async loadSessions(): Promise<BridgeSessionRow[]> {
      // Active checkout sessions on this UTXO chain with a payout xpub
      // configured at the merchant level. Limit the time window so the
      // watcher doesn't re-subscribe to decades of stale sessions on boot.
      const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7); // 7 days
      const rows = await db
        .select({
          sessionId: checkoutSessions.id,
          xpub: merchantPayoutWallets.xpub,
          receiveAddress: checkoutSessions.btcReceiveAddress,
          sessionIndex: checkoutSessions.btcSessionIndex,
          amount: checkoutSessions.amount,
          expiresAt: checkoutSessions.expiresAt,
        })
        .from(checkoutSessions)
        .innerJoin(
          merchantPayoutWallets,
          and(
            eq(merchantPayoutWallets.organizationId, checkoutSessions.organizationId),
            eq(merchantPayoutWallets.networkKey, networkKey),
            eq(merchantPayoutWallets.enabled, true),
            isNotNull(merchantPayoutWallets.xpub),
          ),
        )
        .where(
          and(
            eq(checkoutSessions.networkKey, networkKey),
            inArray(checkoutSessions.status, ["active", "viewed"]),
            gt(checkoutSessions.expiresAt, cutoff),
          ),
        );

      type Row = (typeof rows)[number];
      return rows
        .filter((r: Row): r is Row & { xpub: string } => typeof r.xpub === "string")
        .map((r: Row & { xpub: string }) => ({
          sessionId: r.sessionId,
          xpub: r.xpub,
          receiveAddress: r.receiveAddress ?? null,
          sessionIndex: r.sessionIndex ?? null,
          expectedSats: BigInt(r.amount),
          expiresAt: new Date(r.expiresAt),
        }));
    },

    async persistDerivedAddress(sessionId: string, address: string, index: number): Promise<void> {
      await db
        .update(checkoutSessions)
        .set({ btcReceiveAddress: address, btcSessionIndex: index })
        .where(eq(checkoutSessions.id, sessionId));
    },

    async onPayment(sessionId: string, hit: AddressPaymentHit): Promise<void> {
      // Lookup session + product for the payment row.
      const [session] = await db
        .select({
          id: checkoutSessions.id,
          organizationId: checkoutSessions.organizationId,
          productId: checkoutSessions.productId,
          customerId: checkoutSessions.customerId,
          merchantWallet: checkoutSessions.merchantWallet,
          amount: checkoutSessions.amount,
          tokenSymbol: checkoutSessions.tokenSymbol,
          livemode: checkoutSessions.livemode,
        })
        .from(checkoutSessions)
        .where(eq(checkoutSessions.id, sessionId));

      if (!session) return;
      // customerId on checkout_sessions is nullable; payments.customerId is
      // required. For UTXO payments where the merchant didn't collect a
      // customer identifier, operators should set a placeholder at session
      // creation. If we land here without one, skip writing the payment
      // row but still mark the session completed — better to have a
      // hole in reporting than to throw in the watcher loop.
      if (session.customerId) {
        try {
          await db.insert(payments).values({
            productId: session.productId,
            organizationId: session.organizationId,
            customerId: session.customerId,
            amount: Number(session.amount),
            fee: 0, // UTXO chains have no contract-level fee split; merchant settles off-chain
            status: "confirmed",
            txHash: hit.txid,
            chain: networkKey,
            token: session.tokenSymbol ?? (networkKey.startsWith("bitcoin") ? "BTC" : "LTC"),
            fromAddress: null,
            toAddress: null,
            blockNumber: hit.blockHeight,
            livemode: session.livemode,
          });
        } catch (err) {
          // payments_chain_tx_idx unique index will reject duplicates —
          // expected on replay.
          console.warn(`[utxo-indexer] payment insert for ${sessionId} failed:`, err);
        }
      }

      await db
        .update(checkoutSessions)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(checkoutSessions.id, sessionId));
    },

    async onExpire(sessionId: string): Promise<void> {
      await db
        .update(checkoutSessions)
        .set({ status: "expired" })
        .where(
          and(
            eq(checkoutSessions.id, sessionId),
            inArray(checkoutSessions.status, ["active", "viewed"]),
          ),
        );
    },

    async nextSessionIndex(xpub: string): Promise<number> {
      // Monotonic per xpub — pick MAX(btc_session_index) + 1 so each
      // session gets a unique BIP44 path even across merchants sharing a
      // watcher instance (they won't in practice; one indexer per chain).
      const [row] = await db
        .select({
          maxIdx: max(checkoutSessions.btcSessionIndex),
        })
        .from(checkoutSessions)
        .innerJoin(
          merchantPayoutWallets,
          and(
            eq(merchantPayoutWallets.organizationId, checkoutSessions.organizationId),
            eq(merchantPayoutWallets.xpub, xpub),
          ),
        )
        .where(sql`${checkoutSessions.btcSessionIndex} is not null`);
      const current = row?.maxIdx ?? -1;
      return Number(current) + 1;
    },
  };
}
