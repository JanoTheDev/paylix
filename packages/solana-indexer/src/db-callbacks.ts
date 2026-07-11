/**
 * Drizzle-backed implementation of the Solana indexer's WriterCallbacks.
 * Same posture as packages/utxo-indexer/src/db-callbacks.ts: dependency-
 * injected `db` so tests can pass a fake, try/catch around inserts that can
 * legitimately race (duplicate tx delivery), and unmatched_events retention
 * for anything that can't be written (session-matching miss OR unrecognized
 * mint OR unknown subscription) rather than dropping the event.
 */

import { and, desc, eq, or } from "drizzle-orm";
import { keccak256, stringToBytes } from "viem";
import type { Database } from "@paylix/db/client";
import { payments, checkoutSessions, unmatchedEvents } from "@paylix/db/schema";
import type { WriterCallbacks } from "./writer";
import { resolveMint } from "./token-registry";

export interface SolanaDbCallbacksOptions {
  db: Database;
  networkKey: "solana" | "solana-devnet";
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
    try {
      await db.insert(unmatchedEvents).values({
        eventType,
        txHash,
        blockNumber: slot,
        payload: serializeArgs(payload),
        livemode,
      });
    } catch (err) {
      console.error(`[solana-db-callbacks] failed to record unmatched ${eventType}:`, err);
    }
  }

  async function findMatchingSession(
    customerIdHash: string,
    type: "one_time" | "subscription",
  ) {
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
      .limit(200);

    return candidates.find(
      (s) => keccak256(stringToBytes(s.id)).toLowerCase() === customerIdHash.toLowerCase(),
    );
  }

  return {
    async recordPayment(ev): Promise<void> {
      const session = await findMatchingSession(ev.customerId, "one_time");
      if (!session) {
        await recordUnmatched("SolanaPaymentReceived", ev.signature, ev.slot, ev);
        return;
      }

      let token;
      try {
        token = resolveMint(networkKey, ev.mint);
      } catch {
        await recordUnmatched("SolanaPaymentReceivedUnknownMint", ev.signature, ev.slot, ev);
        return;
      }

      if (session.customerId) {
        const amountCents = Number(ev.amount) / 10 ** (token.decimals - 2);
        const feeCents = Number(ev.fee) / 10 ** (token.decimals - 2);
        try {
          await db.insert(payments).values({
            productId: session.productId,
            organizationId: session.organizationId,
            customerId: session.customerId,
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
          });
        } catch (err) {
          // payments_chain_tx_idx unique index rejects duplicates — expected
          // on redelivery of the same signature.
          console.warn(`[solana-db-callbacks] payment insert for ${session.id} failed:`, err);
        }
      }

      await db
        .update(checkoutSessions)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(checkoutSessions.id, session.id));
    },

    async recordSubscriptionCreated(): Promise<void> {
      throw new Error("not implemented"); // Task 3
    },
    async recordSubscriptionCharged(): Promise<void> {
      throw new Error("not implemented"); // Task 4
    },
    async recordSubscriptionCancelled(): Promise<void> {
      throw new Error("not implemented"); // Task 5
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
