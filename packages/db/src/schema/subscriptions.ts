import { pgTable, uuid, text, boolean, timestamp, pgEnum, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { products } from "./products";
import { customers } from "./customers";
import { payments } from "./payments";

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
    productId: uuid("product_id").notNull().references(() => products.id),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    subscriberAddress: text("subscriber_address").notNull(),
    contractAddress: text("contract_address").notNull(),
    networkKey: text("network_key").notNull(),
    tokenSymbol: text("token_symbol").notNull(),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    nextChargeDate: timestamp("next_charge_date", { withTimezone: true }),
    approvalTxHash: text("approval_tx_hash"),
    lastPaymentId: uuid("last_payment_id").references(() => payments.id),
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
    trialReminderSentAt: timestamp("trial_reminder_sent_at", { withTimezone: true }),
    trialStartedEmailSentAt: timestamp("trial_started_email_sent_at", { withTimezone: true }),
    appliedCouponId: uuid("applied_coupon_id"),
    couponCyclesRemaining: integer("coupon_cycles_remaining"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelScheduledAt: timestamp("cancel_scheduled_at", { withTimezone: true }),
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
  ]
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
