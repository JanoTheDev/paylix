/**
 * The write path for a confirmed UTXO payment, shared by the live watcher
 * callback (`db-callbacks.ts`) and the rate backfill drain
 * (`rate-backfill.ts`) so both settle a payment identically.
 *
 * Ordering is the invariant here: the payment row is written BEFORE the
 * checkout session is flipped to `completed`, and any write failure that is
 * not a duplicate-key race propagates. A session must never read as paid when
 * no payment row exists — see IDX-01.
 */

import { and, eq } from "drizzle-orm";
import type { UtxoChainKey } from "@paylix/utxo-watcher";
import type { Database } from "@paylix/db/client";
import { checkoutSessions, customers, payments, unmatchedEvents } from "@paylix/db/schema";
import { dispatchWebhooks } from "./webhooks";

/** Satoshis in one whole coin — 1e8 for both BTC and LTC. */
const SATS_PER_COIN = 100_000_000n;

/** `unmatched_events.event_type` used for the no-rate retention. */
export const NO_FIAT_RATE_EVENT = "UtxoPaymentReceivedNoFiatRate";

/**
 * Convert an on-chain satoshi amount to the integer cents that
 * `payments.amount` carries, using the fiat rate snapshot captured when the
 * buyer was quoted (`checkout_sessions.fiat_rate_cents`, cents per whole
 * coin).
 *
 *   cents = round(sats * fiatRateCents / 1e8)
 *
 * Done entirely in bigint so no float ever touches a money value, then
 * rounded half-up. There is no fallback conversion on purpose: without a rate
 * there is no honest cents figure. Writing satoshis verbatim reported 100,000
 * sats as $1,000.00; dividing by 10^(8-2) instead reports the same payment as
 * $0.00 and — via `refundedCents + x > amount` in verify-refund — makes it
 * permanently non-refundable. Both are wrong; the caller must refuse the
 * write rather than pick one. See IDX-04.
 */
export function satsToCents(sats: bigint, fiatRateCents: number): number {
  if (!Number.isInteger(fiatRateCents) || fiatRateCents <= 0) {
    throw new Error(`fiatRateCents must be a positive integer, got ${fiatRateCents}`);
  }
  const scaled = sats * BigInt(fiatRateCents);
  return Number((scaled + SATS_PER_COIN / 2n) / SATS_PER_COIN);
}

/** Postgres unique-violation — the expected outcome of replaying a txid. */
export function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 4; depth++) {
    const e = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (e.code === "23505") return true;
    if (
      typeof e.message === "string" &&
      e.message.includes("duplicate key value violates unique constraint")
    ) {
      return true;
    }
    cur = e.cause;
  }
  return false;
}

/** The on-chain facts a settlement needs, independent of who observed them. */
export interface ConfirmedTransfer {
  txid: string;
  blockHeight: number;
  vout: number;
  /** Value actually received at the session's address, in satoshis. */
  receivedSats: bigint;
}

export interface SettlementSession {
  id: string;
  organizationId: string;
  productId: string;
  customerId: string | null;
  amount: bigint;
  tokenSymbol: string | null;
  btcReceiveAddress: string | null;
  fiatRateCents: number | null;
  fiatRateCapturedAt: Date | null;
  livemode: boolean;
}

export interface SettlementOptions {
  db: Database;
  networkKey: UtxoChainKey;
}

export function makeSettlement(opts: SettlementOptions) {
  const { db, networkKey } = opts;

  const defaultToken = networkKey.startsWith("bitcoin") ? "BTC" : "LTC";

  async function loadSession(sessionId: string): Promise<SettlementSession | undefined> {
    const [row] = await db
      .select({
        id: checkoutSessions.id,
        organizationId: checkoutSessions.organizationId,
        productId: checkoutSessions.productId,
        customerId: checkoutSessions.customerId,
        amount: checkoutSessions.amount,
        tokenSymbol: checkoutSessions.tokenSymbol,
        btcReceiveAddress: checkoutSessions.btcReceiveAddress,
        fiatRateCents: checkoutSessions.fiatRateCents,
        fiatRateCapturedAt: checkoutSessions.fiatRateCapturedAt,
        livemode: checkoutSessions.livemode,
      })
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, sessionId));
    return row;
  }

  /**
   * `checkout_sessions.customer_id` is merchant-supplied text;
   * `payments.customer_id` is a uuid FK into `customers`. Resolve one to the
   * other exactly as the EVM handler does, creating the row on first payment.
   * Passing the text identifier straight through is IDX-01.
   *
   * `anonKey` must be unique per buyer. Keying anonymous buyers on the
   * organization merged every UTXO buyer in an org into one customer row,
   * whose portal then listed everyone else's payments and could refund them.
   */
  async function resolveCustomerId(
    session: Pick<SettlementSession, "organizationId" | "customerId" | "livemode">,
    anonKey: string,
  ): Promise<string> {
    const identifier = session.customerId || `anon_${anonKey}`;

    const [existing] = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, session.organizationId),
          eq(customers.customerId, identifier),
        ),
      )
      .limit(1);
    if (existing) return existing.id;

    const [created] = await db
      .insert(customers)
      .values({
        organizationId: session.organizationId,
        customerId: identifier,
        livemode: session.livemode,
      })
      // Without this a concurrent insert raises 23505 and *rejects*, so the
      // recovery re-select below is never reached and the caller's payment is
      // lost. `customers_org_customer_idx` backs the target.
      .onConflictDoNothing({
        target: [customers.organizationId, customers.customerId],
      })
      .returning();
    if (created) return created.id;

    // Lost the insert race against a concurrent hit for the same customer.
    const [raced] = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, session.organizationId),
          eq(customers.customerId, identifier),
        ),
      )
      .limit(1);
    if (!raced) {
      throw new Error(
        `Failed to resolve customer '${identifier}' for org ${session.organizationId}`,
      );
    }
    return raced.id;
  }

  /**
   * Retain a confirmed transfer we cannot price. Lossless by design: the
   * payload carries everything `settle` needs to finish the job once
   * `checkout_sessions.fiat_rate_cents` is populated, and `rate-backfill.ts`
   * drains it.
   */
  async function retainMissingRate(
    session: SettlementSession,
    transfer: ConfirmedTransfer,
  ): Promise<void> {
    // Re-recorded on every backfill pass until a rate exists, so the collision
    // is the normal path here, not the exception: NULL log_index under a
    // NULLS NOT DISTINCT constraint would otherwise 23505 and abort the drain.
    await db
      .insert(unmatchedEvents)
      .values({
        eventType: NO_FIAT_RATE_EVENT,
        txHash: transfer.txid,
        blockNumber: transfer.blockHeight,
        payload: {
          sessionId: session.id,
          chain: networkKey,
          receivedSats: transfer.receivedSats.toString(),
          expectedSats: session.amount.toString(),
          vout: transfer.vout,
        },
        livemode: session.livemode,
      })
      .onConflictDoNothing();
  }

  /**
   * Write the payment, complete the session, fire the webhook.
   *
   * Returns `recorded: false` when the txid was already recorded (a
   * redelivery), in which case the session is deliberately left untouched so
   * `completedAt` isn't moved. Throws when the payment could not be written
   * for any other reason.
   */
  async function settle(
    session: SettlementSession,
    transfer: ConfirmedTransfer,
    fiatRateCents: number,
  ): Promise<{ recorded: boolean; paymentId: string | null }> {
    const token = session.tokenSymbol ?? defaultToken;
    const { receivedSats } = transfer;

    // Anonymous buyers are keyed on the single-use derived receive address
    // so two buyers in the same org never share a customer row; the txid is
    // the fallback when the address somehow isn't persisted.
    const customerId = await resolveCustomerId(
      session,
      session.btcReceiveAddress ?? `${networkKey}_${transfer.txid}`,
    );
    const amountCents = satsToCents(receivedSats, fiatRateCents);

    let paymentId: string | null = null;
    try {
      const [inserted] = await db
        .insert(payments)
        .values({
          productId: session.productId,
          organizationId: session.organizationId,
          customerId,
          amount: amountCents,
          // The exact on-chain amount, which the cents column cannot carry.
          amountSats: receivedSats,
          fiatRateCents,
          fiatRateCapturedAt: session.fiatRateCapturedAt,
          fee: 0, // UTXO chains have no contract-level fee split; merchant settles off-chain
          status: "confirmed",
          txHash: transfer.txid,
          chain: networkKey,
          token,
          fromAddress: null,
          toAddress: session.btcReceiveAddress,
          blockNumber: transfer.blockHeight,
          metadata: { expectedSats: session.amount.toString() },
          livemode: session.livemode,
        })
        .returning();
      paymentId = inserted?.id ?? null;
    } catch (err) {
      // Only a duplicate txid is survivable. Anything else means the payment
      // was NOT recorded — propagate so the session is not marked completed
      // and the buyer is never shown a paid session with no payment row.
      if (!isUniqueViolation(err)) throw err;
      console.warn(
        `[utxo-indexer] payment for ${transfer.txid} already recorded, skipping insert`,
      );
      return { recorded: false, paymentId: null };
    }

    if (!paymentId) return { recorded: false, paymentId: null };

    await db
      .update(checkoutSessions)
      .set({ status: "completed", completedAt: new Date(), paymentId })
      .where(eq(checkoutSessions.id, session.id));

    // A dispatch failure must not unwind a recorded payment; the delivery row
    // carries its own retry state.
    try {
      await dispatchWebhooks(
        db,
        session.organizationId,
        "payment.confirmed",
        {
          id: paymentId,
          checkoutSessionId: session.id,
          productId: session.productId,
          customerId,
          amount: amountCents,
          amountSats: receivedSats.toString(),
          fiatRateCents,
          fee: 0,
          currency: token,
          chain: networkKey,
          txHash: transfer.txid,
          status: "confirmed",
        },
        session.livemode,
      );
    } catch (err) {
      console.error(`[utxo-indexer] webhook dispatch for ${session.id} failed:`, err);
    }

    return { recorded: true, paymentId };
  }

  return { loadSession, resolveCustomerId, retainMissingRate, settle };
}
