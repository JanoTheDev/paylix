import { describe, it, expect } from "vitest";
import type {
  BillingInterval,
  InvoiceEmailStatus,
  PaymentStatus,
  ProductType,
  SubscriptionStatus,
} from "../types";
import type { BlocklistType } from "../blocklist";
import type { CouponDuration, CouponType } from "../coupons";

/**
 * Drift guard for the hand-copied database enums.
 *
 * `packages/sdk` is monorepo-dependency-free by invariant, so it cannot
 * import `packages/db`. Instead each list below is transcribed from a
 * `pgEnum` declaration and pinned to the SDK union through a
 * `Record<Union, true>`: omitting a member fails to compile ("property is
 * missing"), and adding one that is not in the union fails too ("object
 * literal may only specify known properties"). So this file cannot drift
 * from `../types.ts` — only from the database, which is what the
 * transcribed comment on each case is for.
 *
 * When you change a `pgEnum` in `packages/db/src/schema/`, update the
 * matching union in `../types.ts` and this file in the same commit.
 */
function membersOf<T extends string>(map: Record<T, true>): T[] {
  return Object.keys(map) as T[];
}

describe("database enum parity", () => {
  it("subscription_status (packages/db/src/schema/subscriptions.ts)", () => {
    const values = membersOf<SubscriptionStatus>({
      active: true,
      paused: true,
      past_due: true,
      cancelled: true,
      expired: true,
      trialing: true,
      trial_conversion_failed: true,
    });
    // `paused` shipped in the DB enum long before the SDK union had it —
    // consumers writing an exhaustive switch silently fell through.
    expect(values).toContain("paused");
    expect(values).toHaveLength(7);
  });

  it("payment_status (packages/db/src/schema/payments.ts)", () => {
    const values = membersOf<PaymentStatus>({
      pending: true,
      confirmed: true,
      failed: true,
    });
    expect(values).toHaveLength(3);
  });

  it("billing_interval (packages/db/src/schema/products.ts)", () => {
    const values = membersOf<BillingInterval>({
      minutely: true,
      weekly: true,
      biweekly: true,
      monthly: true,
      quarterly: true,
      yearly: true,
    });
    expect(values).toHaveLength(6);
  });

  it("product_type (packages/db/src/schema/products.ts)", () => {
    const values = membersOf<ProductType>({ one_time: true, subscription: true });
    expect(values).toHaveLength(2);
  });

  it("invoice_email_status (packages/db/src/schema/invoices.ts)", () => {
    const values = membersOf<InvoiceEmailStatus>({
      pending: true,
      sent: true,
      failed: true,
      skipped: true,
    });
    expect(values).toHaveLength(4);
  });

  it("blocklist_type (packages/db/src/schema/blocklist-entries.ts)", () => {
    const values = membersOf<BlocklistType>({
      wallet: true,
      email: true,
      country: true,
    });
    expect(values).toHaveLength(3);
  });

  it("coupon_type / coupon_duration (packages/db/src/schema/coupons.ts)", () => {
    expect(membersOf<CouponType>({ percent: true, fixed: true })).toHaveLength(2);
    expect(
      membersOf<CouponDuration>({ once: true, forever: true, repeating: true }),
    ).toHaveLength(3);
  });
});
