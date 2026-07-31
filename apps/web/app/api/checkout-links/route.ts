import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { checkoutSessions, products, productPrices } from "@paylix/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { resolvePayoutWallet } from "@/lib/payout-wallets";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { getPlatformFeeBps } from "../_shared/platform-fee";
import type { NetworkKey } from "@paylix/config/networks";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";

const createCheckoutLinkSchema = z.object({
  productId: z.string().uuid(),
  customerId: z.string().optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

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
      livemode: checkoutSessions.livemode,
    })
    .from(checkoutSessions)
    .leftJoin(products, eq(checkoutSessions.productId, products.id))
    .where(orgScope(checkoutSessions, { organizationId, livemode }))
    .orderBy(desc(checkoutSessions.createdAt));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, session, livemode } = ctx;

  const body = await request.json();
  const parsed = createCheckoutLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_failed", message: "Validation failed", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Scope the lookup in SQL, on BOTH organization and livemode. Checking the
  // org in JS afterwards left the mode unchecked, so a test-mode dashboard
  // could mint a checkout link against a live product — and answered 403
  // rather than 404 for another org's id, which is an existence oracle.
  const [product] = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, data.productId),
        orgScope(products, { organizationId, livemode }),
      ),
    );

  if (!product) {
    return NextResponse.json({ error: { code: "not_found", message: "Product not found" } }, { status: 404 });
  }

  const prices = await db
    .select()
    .from(productPrices)
    .where(
      and(
        eq(productPrices.productId, product.id),
        // product_prices has no organization_id; ownership comes from the
        // product, which is scoped above. Mode still has to be filtered.
        eq(productPrices.livemode, livemode),
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

  // Fee ceiling captured at quote time — see the matching comment in
  // app/api/checkout/route.ts. Every checkout_sessions insert must stamp it,
  // or the relay refuses the session with `fee_ceiling_missing`.
  const deployment = resolveDeploymentForMode(livemode);
  let maxFeeBps: number;
  try {
    maxFeeBps = Number(
      await getPlatformFeeBps({
        contractAddress:
          product.type === "subscription"
            ? deployment.subscriptionManager
            : deployment.paymentVault,
        chain: deployment.chain,
        chainId: deployment.chainId,
        rpcUrl: deployment.rpcUrl,
      }),
    );
  } catch (err) {
    console.error("[checkout-links] platformFee read failed:", err);
    return NextResponse.json(
      {
        error: {
          code: "fee_unavailable",
          message: "Could not read the current platform fee. Try again shortly.",
        },
      },
      { status: 503 },
    );
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [checkoutSession] = await db
    .insert(checkoutSessions)
    .values({
      organizationId,
      livemode,
      productId: product.id,
      customerId: data.customerId ?? null,
      merchantWallet,
      amount: defaultPrice.amount,
      maxFeeBps,
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
