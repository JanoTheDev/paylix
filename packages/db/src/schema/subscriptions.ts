import { pgTable, uuid, text, timestamp, pgEnum, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";
import { products } from "./products";
import { customers } from "./customers";
import { payments } from "./payments";

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active", "past_due", "cancelled", "expired",
]);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => products.id),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    subscriberAddress: text("subscriber_address").notNull(),
    // The SubscriptionManager contract instance that emitted the
    // SubscriptionCreated event this row tracks. Required so redeployed
    // contracts don't collide with stale rows on their onChainId sequences.
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    // Composite unique: onChainId is only unique per SubscriptionManager
    // deployment. After a redeploy the counter resets to 0.
    uniqueIndex("subscriptions_contract_on_chain_id_idx").on(
      table.contractAddress,
      table.onChainId,
    ),
  ]
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
