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
import { checkRateLimitAsync } from "@/lib/rate-limit";
import { clientIpKey } from "../../../_shared/client-ip";
import { readJsonBody, parseWith } from "../../../_shared/http";
import { getToken, type NetworkKey } from "@paylix/config/networks";

const applySchema = z.object({ code: z.string().trim().min(2).max(40) });

/** Statuses in which the amount may still be adjusted by the buyer. */
const OPEN_STATUSES = new Set(["awaiting_currency", "active", "viewed"]);

/**
 * `not_found` vs `coupon_invalid` used to be distinguishable, which turned
 * this unauthenticated endpoint into a code enumerator against the org's
 * whole coupon table. Both now return the same shape.
 */
const COUPON_REJECTED = "That coupon code isn't valid for this checkout.";

async function guardOpenSession(id: string) {
  const [session] = await db
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, id))
    .limit(1);
  if (!session) {
    return { ok: false as const, response: apiError("not_found", "Checkout session not found", 404) };
  }
  if (!OPEN_STATUSES.has(session.status)) {
    return { ok: false as const, response: apiError("invalid_state", "Checkout is not open", 409) };
  }
  if (session.relayInFlightAt !== null) {
    return {
      ok: false as const,
      response: apiError("relay_in_flight", "A payment is being submitted for this session", 409),
    };
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    return { ok: false as const, response: apiError("invalid_state", "Checkout has expired", 409) };
  }
  return { ok: true as const, session };
}

async function guardRate(request: Request, id: string) {
  const ipLimit = await checkRateLimitAsync(
    `coupon:${clientIpKey(request)}`,
    10,
    60_000,
  );
  if (!ipLimit.ok) {
    return apiError(
      "rate_limited",
      `Too many attempts. Retry in ${Math.ceil((ipLimit.retryAfterMs ?? 0) / 1000)}s`,
      429,
    );
  }
  const sessionLimit = await checkRateLimitAsync(`coupon-session:${id}`, 10, 60_000);
  if (!sessionLimit.ok) {
    return apiError(
      "rate_limited",
      `Too many attempts. Retry in ${Math.ceil((sessionLimit.retryAfterMs ?? 0) / 1000)}s`,
      429,
    );
  }
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const limited = await guardRate(request, id);
  if (limited) return limited;

  const rawBody = await readJsonBody(request);
  if (!rawBody.ok) return rawBody.response;
  const parsed = parseWith(applySchema, rawBody.data);
  if (!parsed.ok) return parsed.response;
  const code = canonicalCouponCode(parsed.data.code);

  const guard = await guardOpenSession(id);
  if (!guard.ok) return guard.response;
  const session = guard.session;
  if (session.amount === 0n) {
    // Amount isn't known yet (awaiting_currency). Buyer must pick a currency first.
    return apiError("awaiting_currency", "Pick a currency before applying a coupon", 409);
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
  // Same response as a coupon that exists but doesn't validate — see
  // COUPON_REJECTED.
  if (!coupon) return apiError("coupon_invalid", COUPON_REJECTED, 409);

  // SubscriptionManager.createSubscriptionWithPermit always calls
  // _processPayment on creation, so the on-chain stored amount IS the
  // first charge amount. Lowering session.amount before the intent is
  // signed makes the sub run at the discounted amount every cycle —
  // "forever" semantics.
  //
  // "once" and "repeating" would need the first charge to be lower
  // than subsequent charges. The contract has no way to store two
  // amounts or defer the first charge, so this cannot be done off-chain
  // without a contract change. Keep "forever" as the supported
  // subscription coupon shape.
  if (session.type === "subscription" && coupon.duration !== "forever") {
    return apiError(
      "not_supported",
      "Subscription coupons only support duration 'forever'. 'once' and 'repeating' need contract-level support for a split first-charge amount and are not available off-chain.",
      409,
    );
  }

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
    return apiError("coupon_invalid", COUPON_REJECTED, 409);
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

  // discount_cents is meaningful for percent + fixed one-time and for
  // "forever" subs (where session.amount is lowered). For once/repeating
  // on subs we store the discount in base units so the relay has enough
  // info to assemble the on-chain SubscriptionIntentDiscount.
  const discountForBookkeeping =
    coupon.type === "percent"
      ? Number(discountBaseUnits)
      : coupon.amountOffCents ?? 0;

  // Subscription + once/repeating: DON'T mutate session.amount. The
  // contract stores the full amount with a side-channel discount that
  // expires after N cycles. subtotal_amount stays at the full amount too
  // since it matches the signed intent; discount_cents carries the
  // per-cycle discount in the locked token's base units.
  const subNonForever =
    session.type === "subscription" && coupon.duration !== "forever";

  const newAmount = subNonForever
    ? subtotal
    : subtotal > discountBaseUnits
      ? subtotal - discountBaseUnits
      : 0n;

  await db
    .update(checkoutSessions)
    .set({
      appliedCouponId: coupon.id,
      discountCents: subNonForever
        ? Number(discountBaseUnits)
        : discountForBookkeeping,
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
    discountCents: subNonForever
      ? Number(discountBaseUnits)
      : discountForBookkeeping,
    subtotalAmount: subtotal.toString(),
    amount: newAmount.toString(),
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const limited = await guardRate(request, id);
  if (limited) return limited;

  // The DELETE handler used to check only that the session existed, then
  // rewrote `amount` and nulled `subtotalAmount` — so calling it against a
  // `completed` session mutated the recorded amount *after* payment.
  const guard = await guardOpenSession(id);
  if (!guard.ok) return guard.response;
  const session = guard.session;

  await db
    .update(checkoutSessions)
    .set({
      appliedCouponId: null,
      discountCents: null,
      amount: session.subtotalAmount ?? session.amount,
      subtotalAmount: null,
      // Restoring the pre-discount base also restores a pre-*tax* figure, so
      // the tax snapshot has to go with it. Leaving it populated left
      // taxAmount/taxRateBps/taxLabel describing an amount that no longer
      // includes them.
      taxAmount: null,
      taxRateBps: null,
      taxLabel: null,
    })
    .where(eq(checkoutSessions.id, id));

  return NextResponse.json({ ok: true });
}
