import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  subscriptions,
  products,
  customers as customersTable,
} from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { intervalToSeconds } from "@/lib/billing-intervals";
import { dispatchWebhooks } from "@/lib/webhook-dispatch";
import { findBlocklistMatch, BLOCKLIST_MESSAGE } from "@/lib/blocklist";
import { loadOrgBlocklist } from "@/lib/blocklist-load";
import { withIdempotency } from "@/lib/idempotency";

const giftSchema = z.object({
  productId: z.string().uuid(),
  customerId: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.string()).optional(),
});

/**
 * Merchant-only endpoint to grant a free subscription with no on-chain
 * activity. The sub rides through the rest of the product the same way
 * as a paid one — invoices, webhooks, portal actions — except the
 * keeper never calls chargeSubscription on it.
 */
export async function POST(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  return withIdempotency(request, organizationId, async (rawBody) => {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiError("invalid_body", "Request body must be valid JSON.", 400);
    }
    const parsed = giftSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      "validation_failed",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const { productId, customerId: extCustomerId } = parsed.data;
  const expiresAt = parsed.data.expiresAt
    ? new Date(parsed.data.expiresAt)
    : null;

  const [product] = await db
    .select()
    .from(products)
    .where(
      and(eq(products.id, productId), orgScope(products, { organizationId, livemode })),
    )
    .limit(1);
  if (!product) return apiError("not_found", "Product not found", 404);
  if (product.type !== "subscription") {
    return apiError("invalid_product", "Gift requires a subscription product", 409);
  }

  const [customer] = await db
    .select()
    .from(customersTable)
    .where(
      and(
        eq(customersTable.customerId, extCustomerId),
        orgScope(customersTable, { organizationId, livemode }),
      ),
    )
    .limit(1);
  if (!customer) return apiError("not_found", "Customer not found", 404);

  const blocklist = await loadOrgBlocklist(organizationId, livemode);
  if (blocklist.length > 0) {
    const hit = findBlocklistMatch({
      wallet: customer.walletAddress ?? null,
      email: customer.email ?? null,
      country: customer.country ?? null,
      entries: blocklist,
    });
    if (hit) {
      return apiError("blocked", BLOCKLIST_MESSAGE, 403);
    }
  }

  const intervalSeconds = intervalToSeconds(product.billingInterval);
  const now = new Date();
  const nextChargeDate = expiresAt;

  const [row] = await db
    .insert(subscriptions)
    .values({
      productId: product.id,
      organizationId,
      customerId: customer.id,
      subscriberAddress: "",
      contractAddress: "",
      networkKey: "",
      tokenSymbol: "",
      status: "active",
      intervalSeconds,
      nextChargeDate,
      currentPeriodStart: now,
      currentPeriodEnd: expiresAt,
      metadata: parsed.data.metadata ?? {},
      isGift: true,
      giftExpiresAt: expiresAt,
      livemode,
    })
    .returning();

  void recordAudit({
    organizationId,
    userId,
    action: "subscription.gifted",
    resourceType: "subscription",
    resourceId: row.id,
    details: {
      productId: product.id,
      customerId: customer.customerId,
      expiresAt: expiresAt?.toISOString() ?? null,
    },
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  void dispatchWebhooks(organizationId, "subscription.created", {
    subscriptionId: row.id,
    productId: product.id,
    customerId: customer.customerId,
    gift: true,
    expiresAt: expiresAt?.toISOString() ?? null,
      metadata: row.metadata ?? {},
    }).catch((err) => console.error("[gift] webhook failed:", err));

    return NextResponse.json(row, { status: 201 });
  });
}
