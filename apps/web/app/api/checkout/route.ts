import { db } from "@/lib/db";
import { checkoutSessions, products, productPrices } from "@paylix/db/schema";
import { authenticateApiKey } from "@/lib/api-auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolvePayoutWallet } from "@/lib/payout-wallets";
import type { NetworkKey } from "@paylix/config/networks";

const createCheckoutSchema = z.object({
  productId: z.string().uuid(),
  customerId: z.string().optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  type: z.enum(["one_time", "subscription"]).optional(),
  metadata: z.record(z.string()).optional(),
  networkKey: z.string().optional(),
  tokenSymbol: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request, "secret");
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = createCheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, parsed.data.productId));

  if (!product || product.organizationId !== auth.organizationId) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (!product.isActive) {
    return NextResponse.json({ error: "Product is inactive" }, { status: 400 });
  }

  const data = parsed.data;

  // Fetch all active prices for this product
  const prices = await db
    .select()
    .from(productPrices)
    .where(
      and(
        eq(productPrices.productId, product.id),
        eq(productPrices.isActive, true),
      ),
    );

  if (prices.length === 0) {
    return NextResponse.json(
      { error: "Product has no active prices" },
      { status: 400 },
    );
  }

  // Path A: merchant pre-specified a currency
  let lockedPrice: typeof prices[number] | null = null;
  if (data.networkKey || data.tokenSymbol) {
    if (!data.networkKey || !data.tokenSymbol) {
      return NextResponse.json(
        {
          error:
            "networkKey and tokenSymbol must both be provided when pre-locking",
        },
        { status: 400 },
      );
    }
    lockedPrice =
      prices.find(
        (p) =>
          p.networkKey === data.networkKey &&
          p.tokenSymbol === data.tokenSymbol,
      ) ?? null;
    if (!lockedPrice) {
      return NextResponse.json(
        {
          error: `Product does not accept ${data.tokenSymbol} on ${data.networkKey}`,
        },
        { status: 400 },
      );
    }
  }

  // If locked: resolve merchant's payout wallet at session-create time
  let merchantWallet: `0x${string}`;
  if (lockedPrice) {
    try {
      merchantWallet = await resolvePayoutWallet(
        auth.organizationId,
        lockedPrice.networkKey as NetworkKey,
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Payout wallet error" },
        { status: 400 },
      );
    }
  } else {
    // Path B: awaiting_currency — merchant wallet resolved later when buyer picks
    merchantWallet = "0x0000000000000000000000000000000000000000";
  }

  const [session] = await db
    .insert(checkoutSessions)
    .values({
      organizationId: auth.organizationId,
      productId: product.id,
      customerId: data.customerId ?? null,
      merchantWallet,
      amount: lockedPrice ? lockedPrice.amount : BigInt(0),
      networkKey: lockedPrice?.networkKey ?? null,
      tokenSymbol: lockedPrice?.tokenSymbol ?? null,
      status: lockedPrice ? "active" : "awaiting_currency",
      type: data.type || product.type,
      successUrl: data.successUrl ?? null,
      cancelUrl: data.cancelUrl ?? null,
      metadata: data.metadata || {},
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })
    .returning();

  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

  return NextResponse.json({
    checkoutUrl: `${baseUrl}/checkout/${session.id}`,
    checkoutId: session.id,
    subscriptionId: product.type === "subscription" ? session.id : undefined,
  }, { status: 201 });
}
