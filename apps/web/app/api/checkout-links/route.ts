import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { checkoutSessions, products, productPrices } from "@paylix/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { resolvePayoutWallet } from "@/lib/payout-wallets";
import type { NetworkKey } from "@paylix/config/networks";
import { resolveActiveOrg } from "@/lib/require-active-org";

const createCheckoutLinkSchema = z.object({
  productId: z.string().uuid(),
  customerId: z.string().optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId } = ctx;

  const rows = await db
    .select({
      id: checkoutSessions.id,
      productId: checkoutSessions.productId,
      productName: products.name,
      customerId: checkoutSessions.customerId,
      merchantWallet: checkoutSessions.merchantWallet,
      amount: checkoutSessions.amount,
      networkKey: checkoutSessions.networkKey,
      tokenSymbol: checkoutSessions.tokenSymbol,
      type: checkoutSessions.type,
      status: checkoutSessions.status,
      successUrl: checkoutSessions.successUrl,
      cancelUrl: checkoutSessions.cancelUrl,
      metadata: checkoutSessions.metadata,
      paymentId: checkoutSessions.paymentId,
      subscriptionId: checkoutSessions.subscriptionId,
      viewedAt: checkoutSessions.viewedAt,
      completedAt: checkoutSessions.completedAt,
      expiresAt: checkoutSessions.expiresAt,
      createdAt: checkoutSessions.createdAt,
    })
    .from(checkoutSessions)
    .leftJoin(products, eq(checkoutSessions.productId, products.id))
    .where(eq(checkoutSessions.organizationId, organizationId))
    .orderBy(desc(checkoutSessions.createdAt));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, session } = ctx;

  const body = await request.json();
  const parsed = createCheckoutLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_failed", message: "Validation failed", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const data = parsed.data;

  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, data.productId));

  if (!product) {
    return NextResponse.json({ error: { code: "not_found", message: "Product not found" } }, { status: 404 });
  }

  if (product.organizationId !== organizationId) {
    return NextResponse.json({ error: { code: "forbidden", message: "Unauthorized" } }, { status: 403 });
  }

  const prices = await db
    .select()
    .from(productPrices)
    .where(
      and(
        eq(productPrices.productId, product.id),
        eq(productPrices.isActive, true),
      ),
    )
    .orderBy(productPrices.createdAt);

  if (prices.length === 0) {
    return NextResponse.json(
      { error: { code: "no_active_prices", message: "Product has no active prices. Add a price before generating a link." } },
      { status: 400 },
    );
  }

  const defaultPrice = prices[0];

  let merchantWallet: `0x${string}`;
  try {
    merchantWallet = await resolvePayoutWallet(
      organizationId,
      defaultPrice.networkKey as NetworkKey,
      session.user.id,
    );
  } catch (err) {
    return NextResponse.json(
      { error: { code: "payout_wallet_error", message: err instanceof Error ? err.message : "Payout wallet error" } },
      { status: 400 },
    );
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [checkoutSession] = await db
    .insert(checkoutSessions)
    .values({
      organizationId,
      productId: product.id,
      customerId: data.customerId ?? null,
      merchantWallet,
      amount: defaultPrice.amount,
      networkKey: defaultPrice.networkKey,
      tokenSymbol: defaultPrice.tokenSymbol,
      status: "active",
      type: product.type,
      successUrl: data.successUrl ?? null,
      cancelUrl: data.cancelUrl ?? null,
      expiresAt,
    })
    .returning();

  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  const url = `${baseUrl}/checkout/${checkoutSession.id}`;

  return NextResponse.json(
    {
      id: checkoutSession.id,
      url,
      status: checkoutSession.status,
      expiresAt: checkoutSession.expiresAt,
    },
    { status: 201 }
  );
}
