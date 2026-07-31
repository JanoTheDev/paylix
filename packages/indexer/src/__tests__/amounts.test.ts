import { describe, it, expect } from "vitest";
import { toCents } from "../amounts";

describe("toCents", () => {
  it("converts USDC (6 decimals) base units to integer cents", () => {
    expect(toCents(1_000_000n, 6)).toBe(100); // $1.00
    expect(toCents(10_000n, 6)).toBe(1); // $0.01
    expect(toCents(123_456_789n, 6)).toBe(12346); // $123.46 (rounded)
  });

  it("always returns an integer — the columns are `integer`", () => {
    // Amounts that are not exact multiples of 10^(decimals-2) used to produce a
    // float, which Postgres rejects: the insert throws inside the transaction
    // and the payment is lost.
    const dusty = toCents(1_000_001n, 6);
    expect(Number.isInteger(dusty)).toBe(true);
    expect(dusty).toBe(100);

    expect(Number.isInteger(toCents(999_999_999_999_999n, 18))).toBe(true);
  });

  it("rounds half away from zero, not toward the floor", () => {
    expect(toCents(15_000n, 6)).toBe(2); // 1.5 cents -> 2
    expect(toCents(14_999n, 6)).toBe(1);
  });

  it("handles 18-decimal tokens without a hardcoded divisor", () => {
    // 1 token with 18 decimals = 100 cents.
    expect(toCents(10n ** 18n, 18)).toBe(100);
    expect(toCents(10n ** 16n, 18)).toBe(1);
  });

  it("handles 2-decimal tokens (divisor 1)", () => {
    expect(toCents(100n, 2)).toBe(100);
  });

  it("accepts string and number inputs", () => {
    expect(toCents("1000000", 6)).toBe(100);
    expect(toCents(1_000_000, 6)).toBe(100);
  });

  it("maps zero to zero", () => {
    expect(toCents(0n, 6)).toBe(0);
  });
});
