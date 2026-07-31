import { pgTable, uuid, text, boolean, timestamp, pgEnum, integer, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth";
import { products } from "./products";
import { customers } from "./customers";
import { payments } from "./payments";
import { coupons } from "./coupons";

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "paused",
  "past_due",
  "cancelled",
  "expired",
  "trialing",
  "trial_conversion_failed",
]);

export type PendingPermitSignature = {
  permit: {
    value: string;
    deadline: number;
    v: number;
    r: `0x${string}`;
    s: `0x${string}`;
  };
  intent: {
    merchantId: string;
    amount: string;
    interval: number;
    nonce: string;
    deadline: number;
    signature: `0x${string}`;
    productIdBytes: `0x${string}`;
    customerIdBytes: `0x${string}`;
  };
  priceSnapshot: {
    networkKey: string;
    tokenSymbol: string;
    amount: string;
  };
};

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
    subscriberAddress: text("subscriber_address").notNull(),
    contractAddress: text("contract_address").notNull(),
    networkKey: text("network_key").notNull(),
    tokenSymbol: text("token_symbol").notNull(),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    nextChargeDate: timestamp("next_charge_date", { withTimezone: true }),
    approvalTxHash: text("approval_tx_hash"),
    lastPaymentId: uuid("last_payment_id").references(() => payments.id, { onDelete: "set null" }),
    onChainId: text("on_chain_id"),
    intervalSeconds: integer("interval_seconds"),
    metadata: jsonb("metadata").$type<Record<string, string>>().default({}),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pausedBy: text("paused_by"),
    chargeFailureCount: integer("charge_failure_count").notNull().default(0),
    lastChargeError: text("last_charge_error"),
    lastChargeAttemptAt: timestamp("last_charge_attempt_at", { withTimezone: true }),
    pastDueSince: timestamp("past_due_since", { withTimezone: true }),
    pendingPermitSignature: jsonb("pending_permit_signature").$type<PendingPermitSignature>(),
    trialConversionAttempts: integer("trial_conversion_attempts").notNull().default(0),
    trialConversionLastError: text("trial_conversion_last_error"),
    // Relayer tx that carried createSubscriptionWithPermit for this trial.
    // Requested by the EVM indexer agent for IDX-20 so an operator can tell
    // which transaction a conversion is waiting on, and so a restart mid-wait
    // does not lose the reference.
    trialConversionTxHash: text("trial_conversion_tx_hash"),
    trialReminderSentAt: timestamp("trial_reminder_sent_at", { withTimezone: true }),
    trialStartedEmailSentAt: timestamp("trial_started_email_sent_at", { withTimezone: true }),
    appliedCouponId: uuid("applied_coupon_id").references(() => coupons.id, { onDelete: "set null" }),
    couponCyclesRemaining: integer("coupon_cycles_remaining"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelScheduledAt: timestamp("cancel_scheduled_at", { withTimezone: true }),
    isGift: boolean("is_gift").notNull().default(false),
    giftExpiresAt: timestamp("gift_expires_at", { withTimezone: true }),
    quantity: integer("quantity").notNull().default(1),
    trialConvertedEmailSentAt: timestamp("trial_converted_email_sent_at", { withTimezone: true }),
    trialConversionSubmittedAt: timestamp("trial_conversion_submitted_at", { withTimezone: true }),
    livemode: boolean("livemode").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("subscriptions_contract_on_chain_id_idx").on(
      table.contractAddress,
      table.onChainId,
    ),
    // The keeper's core loop runs `where status = 'active' and
    // next_charge_date <= now()` on every tick
    // (packages/indexer/src/keeper.ts). Without this it is a sequential
    // scan of the whole table, forever.
    index("subscriptions_due_idx").on(table.status, table.nextChargeDate),
    // keeper.ts sweepLongPastDue: `status = 'past_due' and past_due_since <= ?`
    index("subscriptions_past_due_idx").on(table.status, table.pastDueSince),
    // trial-converter.ts: three separate `status = 'trialing' and
    // trial_ends_at <op> ?` scans (convert, remind, started-email).
    index("subscriptions_trial_idx").on(table.status, table.trialEndsAt),
    // Dashboard + API listing: org-scoped, newest first.
    index("subscriptions_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    // Customer detail page and the customer portal list by customer.
    index("subscriptions_customer_idx").on(table.customerId),
    // Trial dedup (apps/web/.../relay/dedup.ts) narrows by org + product
    // before its OR-branch.
    index("subscriptions_org_product_idx").on(
      table.organizationId,
      table.productId,
    ),
    // The trial match-and-activate path (packages/indexer/src/handlers.ts:559)
    // and the trial dedup (dedup.ts:49) both compare
    // `lower(subscriber_address)` — the column is never filtered raw — so this
    // must be an expression index to be used at all. Pure expression (no
    // leading plain column) because drizzle-kit 0.30.6 crashes introspecting a
    // MIXED plain+expression index; see the note in customers.ts.
    index("subscriptions_subscriber_lower_idx").on(
      sql`lower(${table.subscriberAddress})`,
    ),
  ]
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
