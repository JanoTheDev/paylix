/**
 * Drizzle-backed implementations of the utxo-watcher bridge callbacks.
 *
 * Keeps the watcher package DB-agnostic while letting operators still run a
 * one-command indexer process. The bridge calls us; we read/write Postgres
 * via @paylix/db.
 *
 * The payment write path itself lives in `settlement.ts`, shared with the
 * rate backfill drain so both settle a payment identically.
 */

import { and, eq, gt, inArray, isNotNull, max, sql } from "drizzle-orm";
import type { BridgeCallbacks, BridgeSessionRow, UtxoChainKey } from "@paylix/utxo-watcher";
import type { AddressPaymentHit } from "@paylix/utxo-watcher";

import { type Database } from "@paylix/db/client";
import {
  checkoutSessions,
  merchantPayoutWallets,
  payments,
  unmatchedEvents,
} from "@paylix/db/schema";
import { makeSettlement, type ConfirmedTransfer } from "./settlement";

export { satsToCents } from "./settlement";

export interface UtxoDbCallbacksOptions {
  /** Network key this callback set covers — one chain × one env. */
  networkKey: UtxoChainKey;
  /** Drizzle database handle. Pass in so tests can use an in-memory fake. */
  db: Database;
}

export function makeUtxoDbCallbacks(opts: UtxoDbCallbacksOptions): BridgeCallbacks {
  const db = opts.db;
  const { networkKey } = opts;
  const settlement = makeSettlement({ db, networkKey });

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
      const session = await settlement.loadSession(sessionId);
      if (!session) {
        throw new Error(`[utxo-indexer] no checkout session ${sessionId} for tx ${hit.txid}`);
      }

      const transfer: ConfirmedTransfer = {
        txid: hit.txid,
        blockHeight: hit.blockHeight,
        vout: hit.vout,
        // What actually arrived on chain, not what was quoted — the watcher
        // only fires at or above the expected amount, so an overpayment must
        // be recorded at its real value (it also caps refunds).
        receivedSats: hit.valueSats,
      };

      const rate = session.fiatRateCents;
      if (rate === null || rate === undefined || rate <= 0) {
        // No quote-time rate means there is no honest cents figure, and
        // `payments.amount` is NOT NULL. Retain the event so the backfill
        // drain can finish it once the rate is populated, and leave the
        // session open rather than recording a knowingly-wrong money value.
        // See IDX-04, and `rate-backfill.ts` for the recovery path.
        console.error(
          `[utxo-indexer] session ${sessionId} has no fiat rate snapshot; refusing to write ` +
            `a cents amount for tx ${hit.txid} (${transfer.receivedSats} sats). ` +
            `Retained in unmatched_events for the rate backfill drain.`,
        );
        await settlement.retainMissingRate(session, transfer);
        return;
      }

      const { recorded } = await settlement.settle(session, transfer, rate);
      if (!recorded) {
        // Duplicate delivery: the first pass already completed the session.
        // Re-stamping completedAt would move the settlement timestamp.
        console.warn(
          `[utxo-indexer] session ${sessionId} left as-is; payment ${hit.txid} was already recorded`,
        );
      }
    },

    async onUnderpayment(
      sessionId: string,
      hit: AddressPaymentHit,
      shortfallSats: bigint,
    ): Promise<void> {
      // Retain the shortfall so a merchant looking at an expired session can
      // see that funds did arrive and how much was missing. Without a row the
      // buyer's coins sit at a single-use address with nothing explaining it
      // (IDX-33).
      const [session] = await db
        .select({ livemode: checkoutSessions.livemode })
        .from(checkoutSessions)
        .where(eq(checkoutSessions.id, sessionId))
        .limit(1);
      await db.insert(unmatchedEvents).values({
        eventType: "UtxoUnderpayment",
        txHash: hit.txid,
        blockNumber: hit.blockHeight,
        payload: {
          sessionId,
          chain: networkKey,
          receivedSats: hit.valueSats.toString(),
          shortfallSats: shortfallSats.toString(),
          vout: hit.vout,
        },
        livemode: session?.livemode ?? false,
      });
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

    async onReorg(sessionId: string, txid: string): Promise<void> {
      // Drop the confirmed payment row + flip the session back to active so
      // the watcher can re-detect if funds still exist. If the session is
      // past its expiry by now, it will be swept by onExpire on the next
      // cycle. See #76.
      console.warn(
        `[utxo-indexer] reorg detected for session=${sessionId} tx=${txid}; reverting`,
      );
      await db
        .delete(payments)
        .where(and(eq(payments.txHash, txid), eq(payments.chain, networkKey)));
      await db
        .update(checkoutSessions)
        .set({ status: "active", completedAt: null })
        .where(
          and(
            eq(checkoutSessions.id, sessionId),
            eq(checkoutSessions.status, "completed"),
          ),
        );
    },

    async nextSessionIndex(xpub: string, sessionId: string): Promise<number> {
      // Monotonic per xpub. Concurrent tick()s would otherwise read the same
      // MAX and hand out duplicate indices — see issue #74. Hold a txn-scoped
      // advisory lock keyed on the xpub while we read-max and immediately
      // write the reserved index back to the session row; any second caller
      // blocks on the lock and then reads the updated MAX.
      return await db.transaction(async (tx) => {
        const lockKey = xpubLockKey(xpub);
        await tx.execute(sql`select pg_advisory_xact_lock(${lockKey})`);
        const [row] = await tx
          .select({ maxIdx: max(checkoutSessions.btcSessionIndex) })
          .from(checkoutSessions)
          .innerJoin(
            merchantPayoutWallets,
            and(
              eq(merchantPayoutWallets.organizationId, checkoutSessions.organizationId),
              eq(merchantPayoutWallets.xpub, xpub),
            ),
          )
          .where(sql`${checkoutSessions.btcSessionIndex} is not null`);
        const next = Number(row?.maxIdx ?? -1) + 1;
        await tx
          .update(checkoutSessions)
          .set({ btcSessionIndex: next })
          .where(eq(checkoutSessions.id, sessionId));
        return next;
      });
    },
  };
}

/** 64-bit signed advisory-lock key from an xpub — stable across processes. */
function xpubLockKey(xpub: string): bigint {
  let h = 0xcbf29ce484222325n; // FNV-1a 64-bit offset basis
  const prime = 0x100000001b3n;
  for (let i = 0; i < xpub.length; i++) {
    h = (h ^ BigInt(xpub.charCodeAt(i))) * prime;
    h &= 0xffffffffffffffffn;
  }
  // Convert to signed 64-bit for pg_advisory_xact_lock(bigint).
  return h > 0x7fffffffffffffffn ? h - 0x10000000000000000n : h;
}
