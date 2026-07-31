import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { products, productPrices } from "@paylix/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { clientIp } from "../../_shared/client-ip";
import { readJsonBody, parseWith } from "../../_shared/http";
import { productPriceSchema } from "../../_shared/price-schema";
import {
  NETWORKS,
  assertValidNetworkKey,
  assertValidTokenSymbol,
  type NetworkKey,
} from "@paylix/config/networks";

const updateProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  type: z.enum(["one_time", "subscription"]).optional(),
  billingInterval: z
    .enum(["minutely", "weekly", "biweekly", "monthly", "quarterly", "yearly"])
    .nullish(),
  metadata: z.record(z.string()).optional(),
  checkoutFields: z
    .object({
      firstName: z.boolean().optional(),
      lastName: z.boolean().optional(),
      email: z.boolean().optional(),
      phone: z.boolean().optional(),
    })
    .optional(),
  prices: z.array(productPriceSchema).optional(),
  taxRateBps: z.number().int().min(0).max(10000).nullable().optional(),
  taxLabel: z.string().max(64).nullable().optional(),
  reverseChargeEligible: z.boolean().optional(),
  trialDays: z.number().int().min(0).max(365).nullish(),
  trialMinutes: z.number().int().min(0).max(60 * 24).nullish(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const { id } = await params;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseWith(updateProductSchema, body.data);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;

  // Network/token assertions run BEFORE db.transaction so an invalid pair
  // returns a 400 instead of throwing out of the transaction as a 500 —
  // matching the POST route, which already wraps them in try/catch.
  if (data.prices) {
    for (const p of data.prices) {
      try {
        assertValidNetworkKey(p.networkKey);
        assertValidTokenSymbol(
          NETWORKS[p.networkKey as NetworkKey],
          p.tokenSymbol,
        );
      } catch (err) {
        return apiError(
          "invalid_price",
          err instanceof Error ? err.message : "Invalid price entry",
        );
      }
    }
  }

  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, id), orgScope(products, { organizationId, livemode })));
    if (!existing) return null;

    const effectiveType = data.type ?? existing.type;
    const effectiveTrialDays =
      data.trialDays !== undefined ? (data.trialDays ?? 0) : (existing.trialDays ?? 0);
    const effectiveTrialMinutes =
      data.trialMinutes !== undefined
        ? (data.trialMinutes ?? 0)
        : (existing.trialMinutes ?? 0);
    const hasTrial =
      effectiveType === "subscription" &&
      (effectiveTrialDays > 0 || effectiveTrialMinutes > 0);

    let finalCheckoutFields: typeof data.checkoutFields = data.checkoutFields;
    if (hasTrial) {
      const base =
        data.checkoutFields ??
        ((existing.checkoutFields as unknown) as typeof data.checkoutFields) ??
        {};
      finalCheckoutFields = { ...base, email: true };
    }

    const patch: Partial<typeof products.$inferInsert> = {
      name: data.name,
      description: data.description,
      type: data.type,
      billingInterval: data.type === "one_time" ? null : data.billingInterval,
      metadata: data.metadata,
      checkoutFields: finalCheckoutFields,
      taxRateBps: data.taxRateBps,
      taxLabel: data.taxLabel,
      reverseChargeEligible: data.reverseChargeEligible,
    };
    if (data.trialDays !== undefined) {
      patch.trialDays = data.trialDays;
    }
    if (data.trialMinutes !== undefined) {
      patch.trialMinutes = data.trialMinutes;
    }

    const [row] = await tx
      .update(products)
      .set(patch)
      .where(and(eq(products.id, id), orgScope(products, { organizationId, livemode })))
      .returning();

    if (!row) return null;

    if (data.prices) {
      await tx
        .update(productPrices)
        .set({ isActive: false })
        .where(
          and(
            eq(productPrices.productId, id),
            // The product was org-scoped above; keep the deactivation from
            // reaching the other mode's price rows for the same product.
            eq(productPrices.livemode, existing.livemode),
          ),
        );

      await tx
        .insert(productPrices)
        .values(
          data.prices.map((p) => ({
            productId: id,
            // Inherits the product's mode. Without it the column default
            // (false) made every live-mode price row a test-mode row.
            livemode: existing.livemode,
            networkKey: p.networkKey,
            tokenSymbol: p.tokenSymbol,
            amount: BigInt(p.amount),
            isActive: true,
          })),
        )
        .onConflictDoUpdate({
          target: [productPrices.productId, productPrices.networkKey, productPrices.tokenSymbol],
          set: {
            amount: sql`excluded.amount`,
            isActive: sql`excluded.is_active`,
            updatedAt: new Date(),
          },
        });
    }

    return row;
  });

  if (!updated) {
    return apiError("not_found", "Not found", 404);
  }

  void recordAudit({
    organizationId,
    userId,
    action: "product.updated",
    resourceType: "product",
    resourceId: id,
    details: { name: updated.name },
    ipAddress: clientIp(request),
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const { id } = await params;

  const [updated] = await db
    .update(products)
    .set({ isActive: false })
    .where(and(eq(products.id, id), orgScope(products, { organizationId, livemode })))
    .returning();

  if (!updated) {
    return apiError("not_found", "Not found", 404);
  }

  return NextResponse.json({ success: true });
}
