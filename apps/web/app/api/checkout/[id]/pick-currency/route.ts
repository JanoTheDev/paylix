import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { checkoutSessions, productPrices } from "@paylix/db/schema";
import {
  assertValidNetworkKey,
  NETWORKS,
  assertValidTokenSymbol,
  type NetworkKey,
} from "@paylix/config/networks";
import { z } from "zod";
import { readJsonBody, parseWith } from "../../../_shared/http";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { getPlatformFeeBps } from "../../../_shared/platform-fee";
import {
  isUtxoNetwork,
  UTXO_BUYER_NOTICE,
  UTXO_PAYMENTS_ENABLED,
} from "@/app/_lib/utxo-payments";

const pickCurrencySchema = z.object({
  networkKey: z.string().trim().min(1).max(64),
  tokenSymbol: z.string().trim().min(1).max(32),
});

/**
 * Transitions a checkout session from "awaiting_currency" to "active" by
 * locking it to a specific (network, token) pair. The amount is read from
 * the matching product_prices row so the session is authoritative from
 * this point on — the product's price could change later without affecting
 * the session.
 *
 * This endpoint is called by the checkout client's currency picker when
 * the merchant created the session with createCheckout({productId})
 * without pre-specifying a currency. Sessions created with
 * createCheckout({productId, networkKey, tokenSymbol}) skip this endpoint
 * entirely.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const rawBody = await readJsonBody(request);
  if (!rawBody.ok) return rawBody.response;
  const parsed = parseWith(pickCurrencySchema, rawBody.data);
  if (!parsed.ok) return parsed.response;
  const { networkKey, tokenSymbol } = parsed.data;

  // UTXO gate. The checkout UI hides Bitcoin/Litecoin options, but a buyer
  // can POST here directly, so the UI gate is cosmetic without this check.
  //
  // Nothing writes `checkout_sessions.fiat_rate_cents` yet, and the UTXO
  // indexer correctly refuses to convert satoshis to cents without it — it
  // retains the event instead. Locking a session to BTC/LTC today therefore
  // means the buyer sends real coin and watches the session expire with
  // nothing recorded. Fail here, before any coin moves.
  //
  // Runs before assertValidNetworkKey, which only accepts the EVM union and
  // would otherwise mask this with a generic `invalid_network_key`.
  if (!UTXO_PAYMENTS_ENABLED && isUtxoNetwork(networkKey)) {
    return apiError("network_unavailable", UTXO_BUYER_NOTICE, 409);
  }

  try {
    assertValidNetworkKey(networkKey);
  } catch (err) {
    return apiError("invalid_network_key", err instanceof Error ? err.message : "Invalid networkKey");
  }
  try {
    assertValidTokenSymbol(
      NETWORKS[networkKey as NetworkKey],
      tokenSymbol,
    );
  } catch (err) {
    return apiError("invalid_token_symbol", err instanceof Error ? err.message : "Invalid tokenSymbol");
  }

  // Look up the session + verify it's in awaiting_currency state
  const [session] = await db
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, sessionId));

  if (!session) {
    return apiError("not_found", "Session not found", 404);
  }
  // Allow picking from awaiting_currency (first-time selection) AND active
  // (buyer changing their mind before signing). Once the session reaches
  // completed/expired/abandoned the currency is locked for good.
  if (session.status !== "awaiting_currency" && session.status !== "active") {
    return NextResponse.json(
      {
        error: {
          code: "session_currency_locked",
          message: `Session is in state '${session.status}', currency can no longer be changed`,
        },
      },
      { status: 409 },
    );
  }
  if (session.relayInFlightAt !== null) {
    // A relay is mid-flight against the current amount; rewriting it now
    // would change the figure the buyer already signed for.
    return apiError(
      "relay_in_flight",
      "A payment is being submitted for this session",
      409,
    );
  }
  if (new Date(session.expiresAt) < new Date()) {
    return apiError("session_expired", "Session has expired", 410);
  }

  // Find the matching price row for this product
  const [price] = await db
    .select()
    .from(productPrices)
    .where(
      and(
        eq(productPrices.productId, session.productId),
        eq(productPrices.networkKey, networkKey),
        eq(productPrices.tokenSymbol, tokenSymbol),
        eq(productPrices.isActive, true),
      ),
    );

  if (!price) {
    return NextResponse.json(
      {
        error: {
          code: "price_not_available",
          message: `This product does not accept ${tokenSymbol} on ${networkKey}`,
        },
      },
      { status: 400 },
    );
  }

  // Transition the session to active with the locked fields. Scale the
  // stored unit price by the buyer's quantity from the session so
  // downstream (permit/intent signing, relay) sees the total amount.
  // `quantity` comes from the row already loaded above — the second query
  // for it was redundant.
  const qty = session.quantity ?? 1;

  // Re-stamp the fee ceiling. This endpoint IS the quote for a session
  // created without a currency: it is where the amount the buyer will sign
  // over is finally decided. Creation already wrote a ceiling (so the column
  // is never null), but a session can sit in `awaiting_currency` for a while,
  // and re-reading here keeps the ceiling close to the moment of signing
  // without ever moving it to signing time — the guards above reject once
  // `relayInFlightAt` is set or the session leaves an open status, so this
  // can never run against a session that is already being paid.
  const deployment = resolveDeploymentForMode(session.livemode);
  let maxFeeBps: number;
  try {
    maxFeeBps = Number(
      await getPlatformFeeBps({
        contractAddress:
          session.type === "subscription"
            ? deployment.subscriptionManager
            : deployment.paymentVault,
        chain: deployment.chain,
        chainId: deployment.chainId,
        rpcUrl: deployment.rpcUrl,
      }),
    );
  } catch (err) {
    console.error("[pick-currency] platformFee read failed:", err);
    return apiError(
      "fee_unavailable",
      "Could not read the current platform fee. Try again shortly.",
      503,
    );
  }

  // A currency change invalidates every figure derived from the old token:
  // the coupon's base-unit discount, the subtotal snapshot and the tax
  // breakdown. Leaving `appliedCouponId`/`discountCents` in place meant the
  // relay's bookkeeping still incremented `redemptionCount` and wrote a
  // `couponRedemptions` row for a discount that had vanished from `amount`.
  const [updated] = await db
    .update(checkoutSessions)
    .set({
      status: "active",
      networkKey,
      tokenSymbol,
      amount: price.amount * BigInt(qty),
      maxFeeBps,
      appliedCouponId: null,
      discountCents: null,
      subtotalAmount: null,
      taxAmount: null,
      taxRateBps: null,
      taxLabel: null,
    })
    .where(eq(checkoutSessions.id, sessionId))
    .returning();

  return NextResponse.json({
    sessionId: updated.id,
    status: updated.status,
    networkKey: updated.networkKey,
    tokenSymbol: updated.tokenSymbol,
    amount: updated.amount.toString(),
  });
}
