import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { products } from "./products";
import { customers } from "./customers";
import { payments } from "./payments";

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active", "past_due", "cancelled", "expired",
]);

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  subscriberAddress: text("subscriber_address").notNull(),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  nextChargeDate: timestamp("next_charge_date", { withTimezone: true }),
  approvalTxHash: text("approval_tx_hash"),
  lastPaymentId: uuid("last_payment_id").references(() => payments.id),
  onChainId: text("on_chain_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
