import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { checkoutSessions, coupons } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  canonicalCouponCode,
  computeDiscountCents,
  convertCentsToBaseUnits,
  validateCoupon,
  type CouponForMath,
} from "@/lib/coupon-math";
import { apiError } from "@/lib/api-error";
import { getToken, type NetworkKey } from "@paylix/config/networks";

const applySchema = z.object({ code: z.string().min(2).max(40) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    return apiError("validation_failed", "code is required");
  }
  const code = canonicalCouponCode(parsed.data.code);

  const [session] = await db
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, id))
    .limit(1);
  if (!session) return apiError("not_found", "Checkout session not found", 404);
  if (session.status === "completed" || session.status === "expired") {
    return apiError("invalid_state", "Checkout is not open", 409);
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    return apiError("invalid_state", "Checkout has expired", 409);
  }
  if (session.amount === 0n) {
    // Amount isn't known yet (awaiting_currency). Buyer must pick a currency first.
    return apiError("awaiting_currency", "Pick a currency before applying a coupon", 409);
  }
  if (session.type !== "one_time") {
    // v1: coupons only apply to one-time payments. Subscription support
    // requires per-cycle amount override on-chain (SubscriptionManager
    // stores a fixed amount). Tracked as follow-up.
    return apiError(
      "not_supported",
      "Coupons are not yet supported on subscriptions",
      409,
    );
  }

  const [coupon] = await db
    .select()
    .from(coupons)
    .where(
      and(
        eq(coupons.code, code),
        eq(coupons.organizationId, session.organizationId),
        eq(coupons.livemode, session.livemode),
      ),
    )
    .limit(1);
  if (!coupon) return apiError("not_found", "Coupon not found", 404);

  const couponForMath: CouponForMath = {
    type: coupon.type,
    percentOff: coupon.percentOff,
    amountOffCents: coupon.amountOffCents,
    duration: coupon.duration,
    durationInCycles: coupon.durationInCycles,
    maxRedemptions: coupon.maxRedemptions,
    redemptionCount: coupon.redemptionCount,
    redeemBy: coupon.redeemBy,
    isActive: coupon.isActive,
  };

  const validation = validateCoupon(couponForMath, new Date());
  if (!validation.ok) {
    return apiError("coupon_invalid", validation.reason, 409);
  }

  // Preserve the pre-discount amount on subtotalAmount (first apply only).
  // On subsequent swaps or removals we restore from this field so the
  // buyer never ends up with a silently compounded discount.
  const subtotal = session.subtotalAmount ?? session.amount;

  // Branch on coupon type:
  //   percent → math is unit-agnostic, operate directly on base units.
  //   fixed   → amount_off_cents needs conversion to base units using
  //             the locked token's decimal count.
  let discountBaseUnits: bigint;
  if (coupon.type === "percent") {
    const subtotalScalar = Number(subtotal);
    const discountScalar = computeDiscountCents(couponForMath, subtotalScalar);
    discountBaseUnits = BigInt(discountScalar);
  } else {
    // coupon.type === "fixed"
    if (!session.networkKey || !session.tokenSymbol) {
      return apiError(
        "awaiting_currency",
        "Pick a currency before applying a fixed-amount coupon",
        409,
      );
    }
    let decimals: number;
    try {
      const token = getToken(session.networkKey as NetworkKey, session.tokenSymbol);
      decimals = token.decimals;
    } catch {
      return apiError("invalid_currency", "Session token is not registered", 409);
    }
    const amountOff = coupon.amountOffCents ?? 0;
    const offBaseUnits = convertCentsToBaseUnits(amountOff, decimals);
    discountBaseUnits = subtotal < offBaseUnits ? subtotal : offBaseUnits;
  }

  const newAmount = subtotal > discountBaseUnits ? subtotal - discountBaseUnits : 0n;
  // discount_cents is only meaningful for percent coupons (derived from
  // cents-scaled math); for fixed coupons we pass the raw amount_off
  // cents through since that's what the merchant configured.
  const discountForBookkeeping =
    coupon.type === "percent"
      ? Number(discountBaseUnits)
      : coupon.amountOffCents ?? 0;

  await db
    .update(checkoutSessions)
    .set({
      appliedCouponId: coupon.id,
      discountCents: discountForBookkeeping,
      subtotalAmount: subtotal,
      amount: newAmount,
    })
    .where(eq(checkoutSessions.id, id));

  return NextResponse.json({
    ok: true,
    couponId: coupon.id,
    code: coupon.code,
    type: coupon.type,
    percentOff: coupon.percentOff,
    amountOffCents: coupon.amountOffCents,
    duration: coupon.duration,
    durationInCycles: coupon.durationInCycles,
    discountCents: discountForBookkeeping,
    subtotalAmount: subtotal.toString(),
    amount: newAmount.toString(),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [session] = await db
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, id))
    .limit(1);
  if (!session) return apiError("not_found", "Checkout session not found", 404);

  await db
    .update(checkoutSessions)
    .set({
      appliedCouponId: null,
      discountCents: null,
      amount: session.subtotalAmount ?? session.amount,
      subtotalAmount: null,
    })
    .where(eq(checkoutSessions.id, id));

  return NextResponse.json({ ok: true });
}
