import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { coupons } from "@paylix/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { canonicalCouponCode } from "@/lib/coupon-math";
import { withIdempotency } from "@/lib/idempotency";

const createCouponSchema = z
  .object({
    code: z.string().min(2).max(40),
    type: z.enum(["percent", "fixed"]),
    percentOff: z.number().int().min(1).max(100).optional(),
    amountOffCents: z.number().int().min(1).optional(),
    duration: z.enum(["once", "forever", "repeating"]),
    durationInCycles: z.number().int().min(1).max(120).optional(),
    maxRedemptions: z.number().int().min(1).optional(),
    redeemBy: z.string().datetime().optional(),
    firstTimeCustomerOnly: z.boolean().optional(),
  })
  .refine((v) => (v.type === "percent" ? !!v.percentOff : !!v.amountOffCents), {
    message: "percent coupons need percentOff; fixed coupons need amountOffCents",
  })
  .refine(
    (v) => v.duration !== "repeating" || !!v.durationInCycles,
    { message: "repeating duration requires durationInCycles" },
  );

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const rows = await db
    .select()
    .from(coupons)
    .where(orgScope(coupons, { organizationId, livemode }))
    .orderBy(desc(coupons.createdAt));

  return NextResponse.json(rows);
}

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
    const parsed = createCouponSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "validation_failed",
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

  const code = canonicalCouponCode(parsed.data.code);

  const existing = await db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(
        eq(coupons.organizationId, organizationId),
        eq(coupons.code, code),
        eq(coupons.livemode, livemode),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return apiError("code_taken", "A coupon with this code already exists", 409);
  }

  const [row] = await db
    .insert(coupons)
    .values({
      organizationId,
      livemode,
      code,
      type: parsed.data.type,
      percentOff: parsed.data.type === "percent" ? parsed.data.percentOff ?? null : null,
      amountOffCents: parsed.data.type === "fixed" ? parsed.data.amountOffCents ?? null : null,
      duration: parsed.data.duration,
      durationInCycles:
        parsed.data.duration === "repeating" ? parsed.data.durationInCycles ?? null : null,
      maxRedemptions: parsed.data.maxRedemptions ?? null,
      redeemBy: parsed.data.redeemBy ? new Date(parsed.data.redeemBy) : null,
      firstTimeCustomerOnly: parsed.data.firstTimeCustomerOnly ?? false,
    })
    .returning();

  void recordAudit({
    organizationId,
    userId,
    action: "coupon.created",
    resourceType: "coupon",
    resourceId: row.id,
    details: { code, type: row.type },
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

    return NextResponse.json(row, { status: 201 });
  });
}
