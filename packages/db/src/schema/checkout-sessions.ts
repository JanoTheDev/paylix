import { pgTable, uuid, text, bigint, boolean, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { products } from "./products";

export const checkoutStatusEnum = pgEnum("checkout_status", [
  "awaiting_currency", // session created, buyer hasn't selected network/token yet
  "active",            // link created, not yet opened
  "viewed",            // user opened the checkout page
  "abandoned",         // user saw it but left without paying
  "completed",         // payment confirmed
  "expired",           // session expired (30 min default)
]);

export const checkoutSessions = pgTable("checkout_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  customerId: text("customer_id"),
  merchantWallet: text("merchant_wallet").notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  networkKey: text("network_key"),   // nullable while awaiting_currency
  tokenSymbol: text("token_symbol"), // nullable while awaiting_currency
  type: text("type").notNull().default("one_time"),
  collectCountry: boolean("collect_country").notNull().default(false),
  collectTaxId: boolean("collect_tax_id").notNull().default(false),
  status: checkoutStatusEnum("status").notNull().default("active"),
  successUrl: text("success_url"),
  cancelUrl: text("cancel_url"),
  metadata: jsonb("metadata").$type<Record<string, string>>().default({}),
  paymentId: uuid("payment_id"),
  subscriptionId: uuid("subscription_id"),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  relayInFlightAt: timestamp("relay_in_flight_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CheckoutSession = typeof checkoutSessions.$inferSelect;
export type NewCheckoutSession = typeof checkoutSessions.$inferInsert;
