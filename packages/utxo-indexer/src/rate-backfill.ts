/**
 * Recovery drain for UTXO payments that were received but could not be
 * priced.
 *
 * When a confirmed transfer arrives for a session with no
 * `checkout_sessions.fiat_rate_cents`, `db-callbacks.ts` refuses to invent a
 * cents figure and retains the event in `unmatched_events` as
 * `UtxoPaymentReceivedNoFiatRate` (see IDX-04). Nothing else sweeps that
 * retention: the EVM indexer's `retryUnmatchedEvents` only handles
 * `PaymentReceived`, `SubscriptionCreated` and `SubscriptionPaymentReceived`,
 * so it correctly declines these rows — but it bumps `attempts` first, and
 * after 50 passes (~25 minutes) they fall out of its `lt(attempts, 50)`
 * filter for good. This module is that missing drain.
 *
 * It deliberately does NOT invent a rate. Pricing a payment is a business
 * decision — what the coin was worth when the buyer was quoted — so the
 * operator's job is to populate `checkout_sessions.fiat_rate_cents` for the
 * affected sessions (this module logs exactly which ones, with their quote
 * timestamps and amounts). Once the column is set, the next pass settles the
 * payment automatically: payment row, completed session, `payment.confirmed`
 * webhook. Once the web-side rate capture ships, new sessions carry a rate
 * natively and anything queued here drains without manual work.
 *
 * Runs on a timer inside the daemon (`index.ts`). Operators can also force a
 * single pass without waiting, via the CLI in `backfill-cli.ts`:
 *
 *   CHAIN_KEY=bitcoin DATABASE_URL=... npx tsx src/backfill-cli.ts
 */

import { asc, eq } from "drizzle-orm";
import type { UtxoChainKey } from "@paylix/utxo-watcher";
import type { Database } from "@paylix/db/client";
import { unmatchedEvents } from "@paylix/db/schema";
import { makeSettlement, NO_FIAT_RATE_EVENT, type ConfirmedTransfer } from "./settlement";

/** Rows examined per pass. Oldest first, so nothing starves. */
const BATCH_SIZE = 100;

export interface RateBackfillOptions {
  db: Database;
  networkKey: UtxoChainKey;
  /** Rows to examine in one pass (default 100). */
  batchSize?: number;
}

export interface RateBackfillResult {
  examined: number;
  settled: number;
  /** Still waiting on `checkout_sessions.fiat_rate_cents`. */
  pending: number;
  /** Rows whose session no longer exists — retained, needs a human. */
  orphaned: number;
  failed: number;
}

interface RetainedPayload {
  sessionId?: unknown;
  chain?: unknown;
  receivedSats?: unknown;
  vout?: unknown;
}

/**
 * Run one drain pass. Never throws for a single bad row: one unsettleable
 * payment must not block the rest of the queue.
 */
export async function runRateBackfill(
  opts: RateBackfillOptions,
): Promise<RateBackfillResult> {
  const { db, networkKey } = opts;
  const settlement = makeSettlement({ db, networkKey });
  const result: RateBackfillResult = {
    examined: 0,
    settled: 0,
    pending: 0,
    orphaned: 0,
    failed: 0,
  };

  // No `attempts` predicate on purpose: the EVM sweep bumps that counter on
  // rows it declines, so filtering by it would hide exactly the rows we own.
  const rows = await db
    .select()
    .from(unmatchedEvents)
    .where(eq(unmatchedEvents.eventType, NO_FIAT_RATE_EVENT))
    .orderBy(asc(unmatchedEvents.createdAt))
    .limit(opts.batchSize ?? BATCH_SIZE);

  const awaitingRate: string[] = [];

  for (const row of rows) {
    const payload = (row.payload ?? {}) as RetainedPayload;
    // One process per chain × network, so skip other chains' rows.
    if (payload.chain !== networkKey) continue;
    result.examined++;

    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
    if (!sessionId || typeof payload.receivedSats !== "string" || !row.txHash) {
      console.error(
        `[utxo-rate-backfill] unmatched_events ${row.id} has an unusable payload; leaving it in place`,
      );
      result.failed++;
      continue;
    }

    try {
      const session = await settlement.loadSession(sessionId);
      if (!session) {
        // Session deleted (org cascade). The row is the only remaining
        // record of received funds, so it stays put.
        console.error(
          `[utxo-rate-backfill] session ${sessionId} for tx ${row.txHash} no longer exists; ` +
            `retaining unmatched_events ${row.id} — funds were received and need manual reconciliation`,
        );
        result.orphaned++;
        continue;
      }

      const rate = session.fiatRateCents;
      if (rate === null || rate === undefined || rate <= 0) {
        awaitingRate.push(sessionId);
        result.pending++;
        continue;
      }

      const transfer: ConfirmedTransfer = {
        txid: row.txHash,
        blockHeight: row.blockNumber ?? 0,
        vout: typeof payload.vout === "number" ? payload.vout : 0,
        receivedSats: BigInt(payload.receivedSats),
      };

      const { recorded, paymentId } = await settlement.settle(session, transfer, rate);
      // `recorded: false` means the txid was already in `payments` — the work
      // is done either way, so the retention row has served its purpose.
      // Delete only after settle returned; a throw leaves it for next pass.
      await db.delete(unmatchedEvents).where(eq(unmatchedEvents.id, row.id));
      result.settled++;
      console.log(
        `[utxo-rate-backfill] settled session ${sessionId} tx ${row.txHash} — ` +
          (recorded ? `payment ${paymentId}` : "payment was already recorded"),
      );
    } catch (err) {
      // Retained: the row is not deleted, so the next pass retries it.
      console.error(
        `[utxo-rate-backfill] failed to settle unmatched_events ${row.id} ` +
          `(session ${sessionId}, tx ${row.txHash}):`,
        err,
      );
      result.failed++;
    }
  }

  if (awaitingRate.length > 0) {
    console.warn(
      `[utxo-rate-backfill] ${awaitingRate.length} received ${networkKey} payment(s) cannot be ` +
        `priced. Set checkout_sessions.fiat_rate_cents (cents per whole coin, at quote time) ` +
        `for these sessions and they settle automatically on the next pass: ` +
        awaitingRate.join(", "),
    );
  }

  return result;
}

export interface RateBackfillHandle {
  stop(): void;
  /** Run one pass now. Exposed for tests and for an operator-triggered drain. */
  run(): Promise<RateBackfillResult>;
}

/**
 * Schedule the drain. Non-overlapping: the next pass is scheduled only after
 * the previous one settles.
 */
export function startRateBackfill(
  opts: RateBackfillOptions & { intervalMs?: number },
): RateBackfillHandle {
  const intervalMs = opts.intervalMs ?? 5 * 60_000;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const run = () => runRateBackfill(opts);

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await run();
      } catch (err) {
        console.error("[utxo-rate-backfill] pass failed:", err);
      }
      schedule();
    }, intervalMs);
  }
  schedule();

  return {
    run,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
