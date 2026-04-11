import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { checkoutSessions, productPrices } from "@paylix/db/schema";
import {
  assertValidNetworkKey,
  NETWORKS,
  assertValidTokenSymbol,
  type NetworkKey,
} from "@paylix/config/networks";

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

  const body = await request.json().catch(() => ({}));
  const { networkKey, tokenSymbol } = body as {
    networkKey?: string;
    tokenSymbol?: string;
  };

  if (typeof networkKey !== "string" || typeof tokenSymbol !== "string") {
    return NextResponse.json(
      { error: "networkKey and tokenSymbol are required strings" },
      { status: 400 },
    );
  }
  try {
    assertValidNetworkKey(networkKey);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid networkKey" },
      { status: 400 },
    );
  }
  try {
    assertValidTokenSymbol(
      NETWORKS[networkKey as NetworkKey],
      tokenSymbol,
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid tokenSymbol" },
      { status: 400 },
    );
  }

  // Look up the session + verify it's in awaiting_currency state
  const [session] = await db
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, sessionId));

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status !== "awaiting_currency") {
    return NextResponse.json(
      {
        error: {
          code: "session_not_awaiting_currency",
          message: `Session is in state '${session.status}', cannot pick currency`,
        },
      },
      { status: 409 },
    );
  }
  if (new Date(session.expiresAt) < new Date()) {
    return NextResponse.json(
      { error: "Session has expired" },
      { status: 410 },
    );
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

  // Transition the session to active with the locked fields
  const [updated] = await db
    .update(checkoutSessions)
    .set({
      status: "active",
      networkKey,
      tokenSymbol,
      amount: price.amount,
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
