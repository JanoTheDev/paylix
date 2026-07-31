import { request } from "./request";
import type { PaylixConfig } from "./types";

/**
 * Discount shape. Mirrors the `coupon_type` enum in
 * `packages/db/src/schema/coupons.ts`.
 */
export type CouponType = "percent" | "fixed";

/**
 * How long a redeemed coupon keeps applying. Mirrors the
 * `coupon_duration` enum in `packages/db/src/schema/coupons.ts`.
 */
export type CouponDuration = "once" | "forever" | "repeating";

export interface Coupon {
  id: string;
  code: string;
  type: CouponType;
  /** 1-100. Set when `type` is `"percent"`, else null. */
  percentOff: number | null;
  /** Integer cents. Set when `type` is `"fixed"`, else null. */
  amountOffCents: number | null;
  duration: CouponDuration;
  /** Number of billing cycles. Only meaningful when `duration` is `"repeating"`. */
  durationInCycles: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  redeemBy: string | null;
  firstTimeCustomerOnly: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCouponParams {
  /** Case-sensitive code the buyer types at checkout, e.g. `"WELCOME10"`. */
  code: string;
  type: CouponType;
  /** 1-100. Required when `type` is `"percent"`. */
  percentOff?: number;
  /** Integer cents (`500` = $5.00 off). Required when `type` is `"fixed"`. */
  amountOffCents?: number;
  duration: CouponDuration;
  /** Required when `duration` is `"repeating"`. */
  durationInCycles?: number;
  maxRedemptions?: number;
  /** ISO-8601 timestamp after which the code stops working. */
  redeemBy?: string;
  firstTimeCustomerOnly?: boolean;
}

/** Creates a discount code. */
export async function createCoupon(
  config: PaylixConfig,
  params: CreateCouponParams,
): Promise<Coupon> {
  return request<Coupon>(config, "POST", "/api/coupons", { body: params });
}

/** Lists every coupon on the organization, archived ones included. */
export async function listCoupons(config: PaylixConfig): Promise<Coupon[]> {
  return request<Coupon[]>(config, "GET", "/api/coupons");
}

/**
 * Soft-deletes a coupon: the row is kept for reporting on past
 * redemptions, but the code stops working immediately.
 */
export async function archiveCoupon(
  config: PaylixConfig,
  id: string,
): Promise<void> {
  await request<void>(
    config,
    "DELETE",
    `/api/coupons/${encodeURIComponent(id)}`,
  );
}

export interface ApplyCouponResult {
  ok: true;
  couponId: string;
  code: string;
  type: CouponType;
  percentOff: number | null;
  amountOffCents: number | null;
  duration: CouponDuration;
  durationInCycles: number | null;
  /** Discount applied to this session, integer cents. */
  discountCents: number;
  /** Pre-discount total, in the token's native units, as a decimal string. */
  subtotalAmount: string;
  /** Post-discount total, in the token's native units, as a decimal string. */
  amount: string;
}

/**
 * Applies a coupon to an open checkout session and returns the recalculated
 * totals. Replaces any coupon already applied to the session.
 */
export async function applyCouponToCheckout(
  config: PaylixConfig,
  sessionId: string,
  code: string,
): Promise<ApplyCouponResult> {
  return request<ApplyCouponResult>(
    config,
    "POST",
    `/api/checkout/${encodeURIComponent(sessionId)}/apply-coupon`,
    { body: { code } },
  );
}

/** Removes the coupon applied to a checkout session, restoring full price. */
export async function removeCouponFromCheckout(
  config: PaylixConfig,
  sessionId: string,
): Promise<void> {
  await request<void>(
    config,
    "DELETE",
    `/api/checkout/${encodeURIComponent(sessionId)}/apply-coupon`,
  );
}
