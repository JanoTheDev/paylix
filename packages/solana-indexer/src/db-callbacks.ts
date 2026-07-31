/**
 * Drizzle-backed implementation of the Solana indexer's WriterCallbacks.
 * Same posture as packages/utxo-indexer/src/db-callbacks.ts: dependency-
 * injected `db` so tests can pass a fake, and unmatched_events retention
 * for anything that can't be written (session-matching miss OR unrecognized
 * mint OR unknown subscription) rather than dropping the event.
 *
 * Write ordering matters. The payment/subscription row is always written
 * BEFORE the checkout session is flipped to `completed`, and a write failure
 * that isn't a duplicate-key race propagates to the caller. A session must
 * never read as paid when no payment row exists — see IDX-01.
 */

import { and, desc, eq, or } from "drizzle-orm";
import { keccak256, stringToBytes } from "viem";
import type { Database } from "@paylix/db/client";
import {
  payments,
  checkoutSessions,
  customers,
  unmatchedEvents,
  subscriptions,
} from "@paylix/db/schema";
import type { WriterCallbacks } from "./writer";
import { resolveMint, type SolanaTokenInfo } from "./token-registry";
import { dispatchWebhooks } from "./webhooks";

/** Rows per candidate page when reversing the customerId hash to a session. */
const SESSION_PAGE_SIZE = 200;
/** Ceiling on pages scanned so a huge open-session backlog can't stall a tick. */
const SESSION_MAX_PAGES = 10;

export interface SolanaDbCallbacksOptions {
  db: Database;
  networkKey: "solana" | "solana-devnet";
}

/**
 * Postgres 23505. The `payments_chain_tx_idx` / subscription unique indexes
 * reject redelivery of the same signature, which is the expected outcome of
 * the live subscription and the catch-up pass racing — not a failure.
 */
function isUniqueViolation(err: unknown): boolean {
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

export function makeSolanaDbCallbacks(opts: SolanaDbCallbacksOptions): WriterCallbacks {
  const { db, networkKey } = opts;
  const livemode = networkKey === "solana";

  async function recordUnmatched(
    eventType: string,
    txHash: string,
    slot: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // Solana rows carry a NULL log_index and the dedup constraint is
    // NULLS NOT DISTINCT, so a re-recorded signature collides. Without this the
    // second catch-up pass throws 23505, the dispatch fails and the cursor
    // never advances past the first unmatchable event.
    await db
      .insert(unmatchedEvents)
      .values({
        eventType,
        txHash,
        blockNumber: slot,
        payload: serializeArgs(payload),
        livemode,
      })
      .onConflictDoNothing();
  }

  async function findMatchingSession(
    customerIdHash: string,
    type: "one_time" | "subscription",
  ) {
    const target = customerIdHash.toLowerCase();
    // Paginate instead of truncating at a single page: a merchant with more
    // open sessions than one page would otherwise never match (IDX-27).
    for (let page = 0; page < SESSION_MAX_PAGES; page++) {
      const candidates = await db
        .select()
        .from(checkoutSessions)
        .where(
          and(
            eq(checkoutSessions.networkKey, networkKey),
            eq(checkoutSessions.type, type),
            or(eq(checkoutSessions.status, "active"), eq(checkoutSessions.status, "viewed")),
          ),
        )
        .orderBy(desc(checkoutSessions.createdAt))
        .limit(SESSION_PAGE_SIZE)
        .offset(page * SESSION_PAGE_SIZE);

      if (candidates.length === 0) return undefined;
      const hit = candidates.find(
        (s) => keccak256(stringToBytes(s.id)).toLowerCase() === target,
      );
      if (hit) return hit;
      if (candidates.length < SESSION_PAGE_SIZE) return undefined;
    }
    return undefined;
  }

  /**
   * `checkout_sessions.customer_id` is merchant-supplied text;
   * `payments.customer_id` is a uuid FK into `customers`. Resolve one to the
   * other exactly as the EVM handler does, creating the customer row on
   * first payment. Passing the text identifier straight through is IDX-01.
   */
  async function resolveCustomerId(
    session: { organizationId: string; customerId: string | null; livemode: boolean },
    walletAddress: string,
  ): Promise<string> {
    const identifier = session.customerId || `anon_${walletAddress}`;

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
    if (existing) {
      if (!existing.walletAddress) {
        await db
          .update(customers)
          .set({ walletAddress })
          .where(eq(customers.id, existing.id));
      }
      return existing.id;
    }

    const [created] = await db
      .insert(customers)
      .values({
        organizationId: session.organizationId,
        customerId: identifier,
        walletAddress,
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

    // Lost the insert race against a concurrent event for the same customer.
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

  async function emitWebhook(
    organizationId: string,
    event: string,
    data: Record<string, unknown>,
    isLive: boolean,
  ): Promise<void> {
    // Dispatch failures must not unwind an already-recorded payment; the
    // delivery row carries its own retry state.
    try {
      await dispatchWebhooks(db, organizationId, event, data, isLive);
    } catch (err) {
      console.error(`[solana-db-callbacks] webhook dispatch for ${event} failed:`, err);
    }
  }

  return {
    async recordPayment(ev): Promise<void> {
      const session = await findMatchingSession(ev.customerId, "one_time");
      if (!session) {
        await recordUnmatched("SolanaPaymentReceived", ev.signature, ev.slot, ev);
        return;
      }

      let token: SolanaTokenInfo;
      try {
        token = resolveMint(networkKey, ev.mint);
      } catch (err) {
        console.warn(
          `[solana-db-callbacks] unknown mint ${ev.mint} on ${networkKey}, retaining event:`,
          err,
        );
        await recordUnmatched("SolanaPaymentReceivedUnknownMint", ev.signature, ev.slot, ev);
        return;
      }

      const customerId = await resolveCustomerId(session, ev.buyer);
      const centsDivisor = 10 ** (token.decimals - 2);
      const amountCents = Math.round(Number(ev.amount) / centsDivisor);
      const feeCents = Math.round(Number(ev.fee) / centsDivisor);

      let paymentId: string | null = null;
      try {
        const [inserted] = await db
          .insert(payments)
          .values({
            productId: session.productId,
            organizationId: session.organizationId,
            customerId,
            amount: amountCents,
            fee: feeCents,
            status: "confirmed",
            txHash: ev.signature,
            chain: networkKey,
            token: token.symbol,
            fromAddress: ev.buyer,
            toAddress: ev.merchant,
            blockNumber: ev.slot,
            livemode: session.livemode,
          })
          .returning();
        paymentId = inserted?.id ?? null;
      } catch (err) {
        // Only a duplicate signature is survivable. Anything else means the
        // payment was NOT recorded — propagate so the session stays open and
        // the catch-up pass replays it.
        if (!isUniqueViolation(err)) throw err;
        console.warn(
          `[solana-db-callbacks] payment for ${ev.signature} already recorded, skipping insert`,
        );
      }

      if (paymentId) {
        await db
          .update(checkoutSessions)
          .set({ status: "completed", completedAt: new Date(), paymentId })
          .where(eq(checkoutSessions.id, session.id));
      } else {
        // Duplicate signature: the first pass already completed the session.
        // Re-stamping completedAt would move the settlement timestamp.
        console.warn(
          `[solana-db-callbacks] session ${session.id} left as-is; ${ev.signature} was already recorded`,
        );
      }

      if (paymentId) {
        await emitWebhook(
          session.organizationId,
          "payment.confirmed",
          {
            id: paymentId,
            checkoutSessionId: session.id,
            productId: session.productId,
            customerId,
            amount: amountCents,
            fee: feeCents,
            currency: token.symbol,
            chain: networkKey,
            txHash: ev.signature,
            status: "confirmed",
          },
          session.livemode,
        );
      }
    },

    async recordSubscriptionCreated(ev): Promise<void> {
      const session = await findMatchingSession(ev.customerId, "subscription");
      if (!session) {
        await recordUnmatched("SolanaSubscriptionCreated", ev.signature, ev.slot, ev);
        return;
      }

      let token: SolanaTokenInfo;
      try {
        token = resolveMint(networkKey, ev.mint);
      } catch (err) {
        console.warn(
          `[solana-db-callbacks] unknown mint ${ev.mint} on ${networkKey}, retaining event:`,
          err,
        );
        await recordUnmatched("SolanaSubscriptionCreatedUnknownMint", ev.signature, ev.slot, ev);
        return;
      }

      const customerId = await resolveCustomerId(session, ev.subscriber);
      const intervalSeconds = Number(ev.intervalSeconds);
      const now = new Date();
      const nextChargeDate = new Date(now.getTime() + intervalSeconds * 1000);

      let subscriptionId: string | null = null;
      try {
        const [inserted] = await db
          .insert(subscriptions)
          .values({
            productId: session.productId,
            organizationId: session.organizationId,
            customerId,
            subscriberAddress: ev.subscriber,
            contractAddress: ev.programId,
            networkKey,
            tokenSymbol: token.symbol,
            status: "active",
            onChainId: ev.subscriptionId.toString(),
            intervalSeconds,
            currentPeriodStart: now,
            currentPeriodEnd: nextChargeDate,
            nextChargeDate,
            livemode: session.livemode,
          })
          .returning();
        subscriptionId = inserted?.id ?? null;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        console.warn(
          `[solana-db-callbacks] subscription ${ev.subscriptionId} already recorded, skipping insert`,
        );
      }

      if (subscriptionId) {
        await db
          .update(checkoutSessions)
          .set({ status: "completed", completedAt: new Date(), subscriptionId })
          .where(eq(checkoutSessions.id, session.id));
      } else {
        console.warn(
          `[solana-db-callbacks] session ${session.id} left as-is; subscription ` +
            `${ev.subscriptionId} was already recorded`,
        );
      }

      if (subscriptionId) {
        await emitWebhook(
          session.organizationId,
          "subscription.created",
          {
            id: subscriptionId,
            checkoutSessionId: session.id,
            productId: session.productId,
            customerId,
            onChainId: ev.subscriptionId.toString(),
            intervalSeconds,
            currency: token.symbol,
            chain: networkKey,
            status: "active",
          },
          session.livemode,
        );
      }
    },

    async recordSubscriptionCharged(ev): Promise<void> {
      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.contractAddress, ev.programId),
            eq(subscriptions.onChainId, ev.subscriptionId.toString()),
          ),
        )
        .limit(1);

      if (!subscription) {
        // Could be a race with recordSubscriptionCreated on the same slot.
        await recordUnmatched("SolanaSubscriptionCharged", ev.signature, ev.slot, ev);
        return;
      }

      let token: SolanaTokenInfo;
      try {
        token = resolveMint(networkKey, ev.mint);
      } catch (err) {
        console.warn(
          `[solana-db-callbacks] unknown mint ${ev.mint} on ${networkKey}, retaining event:`,
          err,
        );
        await recordUnmatched("SolanaSubscriptionChargedUnknownMint", ev.signature, ev.slot, ev);
        return;
      }

      const amountCents = Math.round(Number(ev.amount) / 10 ** (token.decimals - 2));

      let paymentId: string | null = null;
      try {
        const [inserted] = await db
          .insert(payments)
          .values({
            productId: subscription.productId,
            organizationId: subscription.organizationId,
            customerId: subscription.customerId,
            amount: amountCents,
            fee: 0,
            status: "confirmed",
            txHash: ev.signature,
            chain: networkKey,
            token: token.symbol,
            fromAddress: ev.subscriber,
            toAddress: ev.merchantAta,
            blockNumber: ev.slot,
            livemode: subscription.livemode,
          })
          .returning();
        paymentId = inserted?.id ?? null;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Already recorded — the period was advanced on the first pass too.
        console.warn(
          `[solana-db-callbacks] recurring payment for ${ev.signature} already recorded, skipping`,
        );
        return;
      }

      const intervalMs = (subscription.intervalSeconds ?? 0) * 1000;
      const now = new Date();
      // Advance from the existing nextChargeDate when we have one so the
      // billing schedule doesn't drift by the keeper's polling latency.
      const anchor = subscription.nextChargeDate ?? now;
      const nextChargeDate = new Date(anchor.getTime() + intervalMs);
      await db
        .update(subscriptions)
        .set({
          currentPeriodStart: anchor,
          currentPeriodEnd: nextChargeDate,
          nextChargeDate,
          pastDueSince: null,
          chargeFailureCount: 0,
          lastChargeError: null,
          ...(paymentId ? { lastPaymentId: paymentId } : {}),
        })
        .where(eq(subscriptions.id, subscription.id));

      if (paymentId) {
        await emitWebhook(
          subscription.organizationId,
          "payment.confirmed",
          {
            id: paymentId,
            subscriptionId: subscription.id,
            productId: subscription.productId,
            customerId: subscription.customerId,
            amount: amountCents,
            fee: 0,
            currency: token.symbol,
            chain: networkKey,
            txHash: ev.signature,
            status: "confirmed",
          },
          subscription.livemode,
        );
      }
    },

    async recordSubscriptionCancelled(ev): Promise<void> {
      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.contractAddress, ev.programId),
            eq(subscriptions.onChainId, ev.subscriptionId.toString()),
          ),
        )
        .limit(1);

      if (!subscription) {
        await recordUnmatched("SolanaSubscriptionCancelled", ev.signature, ev.slot, ev);
        return;
      }

      await db
        .update(subscriptions)
        .set({ status: "cancelled" })
        .where(eq(subscriptions.id, subscription.id));

      if (subscription.status !== "cancelled") {
        await emitWebhook(
          subscription.organizationId,
          "subscription.cancelled",
          {
            id: subscription.id,
            productId: subscription.productId,
            customerId: subscription.customerId,
            onChainId: ev.subscriptionId.toString(),
            chain: networkKey,
            status: "cancelled",
          },
          subscription.livemode,
        );
      }
    },
  };
}

function serializeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}
