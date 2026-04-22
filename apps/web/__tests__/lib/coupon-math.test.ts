import { describe, it, expect } from "vitest";
import {
  canonicalCouponCode,
  validateCoupon,
  computeDiscountCents,
  appliesToCycle,
  convertCentsToBaseUnits,
  type CouponForMath,
} from "../../lib/coupon-math";

const now = new Date("2026-04-22T12:00:00Z");

function base(overrides: Partial<CouponForMath> = {}): CouponForMath {
  return {
    type: "percent",
    percentOff: 25,
    amountOffCents: null,
    duration: "once",
    durationInCycles: null,
    maxRedemptions: null,
    redemptionCount: 0,
    redeemBy: null,
    isActive: true,
    ...overrides,
  };
}

describe("canonicalCouponCode", () => {
  it("uppercases and trims", () => {
    expect(canonicalCouponCode("  spring25  ")).toBe("SPRING25");
  });
});

describe("validateCoupon", () => {
  it("ok for a fresh active percent coupon", () => {
    expect(validateCoupon(base(), now)).toEqual({ ok: true });
  });

  it("rejects inactive", () => {
    expect(validateCoupon(base({ isActive: false }), now)).toEqual({
      ok: false,
      reason: "not_active",
    });
  });

  it("rejects past redeemBy", () => {
    expect(
      validateCoupon(base({ redeemBy: new Date(now.getTime() - 1) }), now),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects exhausted", () => {
    expect(
      validateCoupon(
        base({ maxRedemptions: 5, redemptionCount: 5 }),
        now,
      ),
    ).toEqual({ ok: false, reason: "exhausted" });
  });

  it("rejects percent out of bounds", () => {
    expect(validateCoupon(base({ percentOff: 0 }), now)).toEqual({
      ok: false,
      reason: "invalid_percent",
    });
    expect(validateCoupon(base({ percentOff: 150 }), now)).toEqual({
      ok: false,
      reason: "invalid_percent",
    });
  });

  it("rejects fixed coupon with no amount", () => {
    expect(
      validateCoupon(
        base({ type: "fixed", percentOff: null, amountOffCents: null }),
        now,
      ),
    ).toEqual({ ok: false, reason: "invalid_amount" });
  });
});

describe("computeDiscountCents", () => {
  it("25% off $10.00 = $2.50", () => {
    expect(computeDiscountCents(base({ percentOff: 25 }), 1000)).toBe(250);
  });

  it("floors the percent math (no over-discount)", () => {
    // 33% of 10 cents = 3.3 → 3
    expect(computeDiscountCents(base({ percentOff: 33 }), 10)).toBe(3);
  });

  it("fixed amount clamps to total", () => {
    const coupon = base({
      type: "fixed",
      percentOff: null,
      amountOffCents: 5000,
    });
    expect(computeDiscountCents(coupon, 1000)).toBe(1000);
  });

  it("zero amount = zero discount", () => {
    expect(computeDiscountCents(base(), 0)).toBe(0);
  });

  it("100% off returns full amount", () => {
    expect(computeDiscountCents(base({ percentOff: 100 }), 1234)).toBe(1234);
  });
});

describe("appliesToCycle", () => {
  it("once applies to cycle 0 only", () => {
    expect(appliesToCycle({ duration: "once", durationInCycles: null }, 0)).toBe(true);
    expect(appliesToCycle({ duration: "once", durationInCycles: null }, 1)).toBe(false);
  });

  it("forever applies to any cycle", () => {
    expect(appliesToCycle({ duration: "forever", durationInCycles: null }, 0)).toBe(true);
    expect(appliesToCycle({ duration: "forever", durationInCycles: null }, 99)).toBe(true);
  });

  it("repeating applies for N cycles", () => {
    const c = { duration: "repeating" as const, durationInCycles: 3 };
    expect(appliesToCycle(c, 0)).toBe(true);
    expect(appliesToCycle(c, 2)).toBe(true);
    expect(appliesToCycle(c, 3)).toBe(false);
  });

  it("negative cycle rejected", () => {
    expect(appliesToCycle({ duration: "forever", durationInCycles: null }, -1)).toBe(false);
  });
});

describe("convertCentsToBaseUnits", () => {
  it("USDC (6 decimals): 250 cents → 2_500_000", () => {
    expect(convertCentsToBaseUnits(250, 6)).toBe(2_500_000n);
  });

  it("hypothetical 18-decimal token: 100 cents → 1e18", () => {
    expect(convertCentsToBaseUnits(100, 18)).toBe(1_000_000_000_000_000_000n);
  });

  it("2-decimal token: 1 cent → 1", () => {
    expect(convertCentsToBaseUnits(1, 2)).toBe(1n);
  });

  it("zero cents → zero base units", () => {
    expect(convertCentsToBaseUnits(0, 6)).toBe(0n);
  });

  it("throws on negative cents", () => {
    expect(() => convertCentsToBaseUnits(-1, 6)).toThrow();
  });

  it("throws on decimals < 2", () => {
    expect(() => convertCentsToBaseUnits(100, 1)).toThrow();
  });
});
