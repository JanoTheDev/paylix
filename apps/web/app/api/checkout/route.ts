import { db } from "@/lib/db";
import { checkoutSessions, products, productPrices } from "@paylix/db/schema";
import { authenticateApiKey } from "@/lib/api-auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolvePayoutWallet } from "@/lib/payout-wallets";
import { resolveDeploymentForMode } from "@/lib/deployment";
import { getPlatformFeeBps } from "../_shared/platform-fee";
import type { NetworkKey } from "@paylix/config/networks";
import { apiError } from "@/lib/api-error";
import { withIdempotency } from "@/lib/idempotency";
import { orgScope } from "@/lib/org-scope";
import {
  isUtxoNetwork,
  UTXO_MERCHANT_NOTICE,
  UTXO_PAYMENTS_ENABLED,
} from "@/app/_lib/utxo-payments";

const createCheckoutSchema = z.object({
  productId: z.string().uuid(),
  customerId: z.string().optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  type: z.enum(["one_time", "subscription"]).optional(),
  metadata: z.record(z.string()).optional(),
  networkKey: z.string().optional(),
  tokenSymbol: z.string().optional(),
  quantity: z.number().int().min(1).optional(),
});

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request, "secret");
  if (auth?.rateLimitResponse) return auth.rateLimitResponse;
  if (!auth) return apiError("unauthorized", "Authentication required", 401);

  return withIdempotency(request, auth.organizationId, async (rawBody) => {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiError("invalid_body", "Request body must be valid JSON.", 400);
    }
    const parsed = createCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join("; ");
      return apiError("validation_failed", issues);
    }

    // Scope in SQL on BOTH organization and livemode. Checking the org in JS
    // left the mode unchecked, so an `sk_test_` key could open a checkout
    // against a live product (and vice versa) — the read-side twin of the
    // missing `livemode` on the insert below.
    const [product] = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.id, parsed.data.productId),
          orgScope(products, {
            organizationId: auth.organizationId,
            livemode: auth.livemode,
          }),
        ),
      );

    if (!product) {
      return apiError("not_found", "Product not found", 404);
    }

    if (!product.isActive) {
      return apiError("product_inactive", "Product is inactive");
    }

    const data = parsed.data;

    // Fetch all active prices for this product
    const prices = await db
      .select()
      .from(productPrices)
      .where(
        and(
          eq(productPrices.productId, product.id),
          // Ownership comes from the (already scoped) product; mode still
          // has to be filtered explicitly.
          eq(productPrices.livemode, auth.livemode),
          eq(productPrices.isActive, true),
        ),
      );

    if (prices.length === 0) {
      return apiError("no_active_prices", "Product has no active prices");
    }

    // Path A: merchant pre-specified a currency
    let lockedPrice: typeof prices[number] | null = null;
    if (data.networkKey || data.tokenSymbol) {
      if (!data.networkKey || !data.tokenSymbol) {
        return apiError("invalid_request", "networkKey and tokenSymbol must both be provided when pre-locking");
      }
      // See pick-currency for the full reasoning: nothing captures a fiat
      // rate yet, so a UTXO-denominated session can never settle. Reject at
      // creation rather than handing the merchant a link that eats coin.
      if (!UTXO_PAYMENTS_ENABLED && isUtxoNetwork(data.networkKey)) {
        return apiError("network_unavailable", UTXO_MERCHANT_NOTICE, 409);
      }
      lockedPrice =
        prices.find(
          (p) =>
            p.networkKey === data.networkKey &&
            p.tokenSymbol === data.tokenSymbol,
        ) ?? null;
      if (!lockedPrice) {
        return apiError("price_not_available", `Product does not accept ${data.tokenSymbol} on ${data.networkKey}`);
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
        return apiError("payout_wallet_error", err instanceof Error ? err.message : "Payout wallet error");
      }
    } else {
      // Path B: awaiting_currency — merchant wallet resolved later when buyer picks
      merchantWallet = "0x0000000000000000000000000000000000000000";
    }

    // Quantity handling. Only allowed when the product opts in.
    // Amount scales linearly; bounds clamped to min/max set on the
    // product. Default 1 for products without the toggle.
    const quantity = data.quantity ?? 1;
    if (quantity > 1 && !product.allowQuantity) {
      return apiError(
        "quantity_not_allowed",
        "This product does not accept a quantity > 1",
      );
    }
    if (quantity < product.minQuantity) {
      return apiError(
        "quantity_below_min",
        `Minimum quantity is ${product.minQuantity}`,
      );
    }
    if (product.maxQuantity !== null && quantity > product.maxQuantity) {
      return apiError(
        "quantity_above_max",
        `Maximum quantity is ${product.maxQuantity}`,
      );
    }

    const scaledAmount = lockedPrice
      ? lockedPrice.amount * BigInt(quantity)
      : BigInt(0);

    // Stamp the fee ceiling the buyer will sign over, at quote time.
    //
    // Reading `platformFee()` live at signature time instead would leave a
    // window where the owner raises the fee between the buyer being quoted
    // and the buyer signing — exactly what binding `maxFeeBps` into the
    // intent is meant to prevent (SC-03). Capturing it here means the
    // ceiling is the one in force when the price was shown.
    const deployment = resolveDeploymentForMode(auth.livemode);
    let maxFeeBps: number;
    try {
      maxFeeBps = Number(
        await getPlatformFeeBps({
          contractAddress:
            (data.type ?? product.type) === "subscription"
              ? deployment.subscriptionManager
              : deployment.paymentVault,
          chain: deployment.chain,
          chainId: deployment.chainId,
          rpcUrl: deployment.rpcUrl,
        }),
      );
    } catch (err) {
      console.error("[checkout] platformFee read failed:", err);
      return apiError(
        "fee_unavailable",
        "Could not read the current platform fee. Try again shortly.",
        503,
      );
    }

    const [session] = await db
      .insert(checkoutSessions)
      .values({
        organizationId: auth.organizationId,
        // Without this the column defaults to false and a `sk_live_` key
        // produces a test-mode session, which the relay then routes to the
        // testnet deployment via resolveDeploymentForMode(session.livemode).
        livemode: auth.livemode,
        productId: product.id,
        customerId: data.customerId ?? null,
        merchantWallet,
        amount: scaledAmount,
        maxFeeBps,
        networkKey: lockedPrice?.networkKey ?? null,
        tokenSymbol: lockedPrice?.tokenSymbol ?? null,
        status: lockedPrice ? "active" : "awaiting_currency",
        type: data.type || product.type,
        quantity,
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
  });
}
