import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { products, productPrices } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { recordAudit } from "@/lib/audit";
import { z } from "zod";
import { apiError } from "@/lib/api-error";
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
  prices: z
    .array(
      z.object({
        networkKey: z.string(),
        tokenSymbol: z.string(),
        amount: z.string(),
      }),
    )
    .optional(),
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
  const { organizationId, userId } = ctx;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateProductSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join("; ");
    return apiError("validation_failed", issues);
  }

  const data = parsed.data;

  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.organizationId, organizationId)));
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
      .where(and(eq(products.id, id), eq(products.organizationId, organizationId)))
      .returning();

    if (!row) return null;

    if (data.prices) {
      for (const p of data.prices) {
        assertValidNetworkKey(p.networkKey);
        assertValidTokenSymbol(
          NETWORKS[p.networkKey as NetworkKey],
          p.tokenSymbol,
        );
      }

      await tx
        .update(productPrices)
        .set({ isActive: false })
        .where(eq(productPrices.productId, id));

      await tx.insert(productPrices).values(
        data.prices.map((p) => ({
          productId: id,
          networkKey: p.networkKey,
          tokenSymbol: p.tokenSymbol,
          amount: BigInt(p.amount),
          isActive: true,
        })),
      );
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
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId } = ctx;

  const { id } = await params;

  const [updated] = await db
    .update(products)
    .set({ isActive: false })
    .where(and(eq(products.id, id), eq(products.organizationId, organizationId)))
    .returning();

  if (!updated) {
    return apiError("not_found", "Not found", 404);
  }

  return NextResponse.json({ success: true });
}
