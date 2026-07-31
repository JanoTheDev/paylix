import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { checkoutSessions } from "./checkout-sessions";
import { subscriptions } from "./subscriptions";
import { payments } from "./payments";

export const couponTypeEnum = pgEnum("coupon_type", ["percent", "fixed"]);
export const couponDurationEnum = pgEnum("coupon_duration", [
  "once",
  "forever",
  "repeating",
]);

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    type: couponTypeEnum("type").notNull(),
    percentOff: integer("percent_off"),
    amountOffCents: integer("amount_off_cents"),
    duration: couponDurationEnum("duration").notNull(),
    durationInCycles: integer("duration_in_cycles"),
    maxRedemptions: integer("max_redemptions"),
    redemptionCount: integer("redemption_count").notNull().default(0),
    redeemBy: timestamp("redeem_by", { withTimezone: true }),
    firstTimeCustomerOnly: boolean("first_time_customer_only")
      .notNull()
      .default(false),
    isActive: boolean("is_active").notNull().default(true),
    livemode: boolean("livemode").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // livemode is part of the key so the same code (e.g. WELCOME10) can exist
    // in both test and live mode — matching blocklist_entries_unique. Every
    // lookup already filters livemode
    // (apps/web/app/api/checkout/[id]/apply-coupon/route.ts:51-53), and this
    // index is not an ON CONFLICT target anywhere, so widening it is safe.
    uniqueIndex("coupons_org_code_idx").on(
      table.organizationId,
      table.code,
      table.livemode,
    ),
    // Dashboard list: org-scoped, newest first.
    index("coupons_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    checkoutSessionId: uuid("checkout_session_id").references(
      () => checkoutSessions.id,
      { onDelete: "set null" },
    ),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    paymentId: uuid("payment_id").references(() => payments.id, {
      onDelete: "set null",
    }),
    discountCents: integer("discount_cents").notNull(),
    cycleNumber: integer("cycle_number"),
    livemode: boolean("livemode").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("coupon_redemptions_coupon_idx").on(table.couponId),
    index("coupon_redemptions_subscription_idx").on(table.subscriptionId),
  ],
);

export type Coupon = typeof coupons.$inferSelect;
export type NewCoupon = typeof coupons.$inferInsert;
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
export type NewCouponRedemption = typeof couponRedemptions.$inferInsert;
