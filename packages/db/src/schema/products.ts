import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const productTypeEnum = pgEnum("product_type", [
  "one_time",
  "subscription",
]);
export const billingIntervalEnum = pgEnum("billing_interval", [
  "minutely",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
]);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  type: productTypeEnum("type").notNull(),
  billingInterval: billingIntervalEnum("billing_interval"),
  isActive: boolean("is_active").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, string>>().default({}),
  checkoutFields: jsonb("checkout_fields")
    .$type<{
      firstName?: boolean;
      lastName?: boolean;
      email?: boolean;
      phone?: boolean;
    }>()
    .default({}),
  taxRateBps: integer("tax_rate_bps"),
  taxLabel: text("tax_label"),
  reverseChargeEligible: boolean("reverse_charge_eligible")
    .notNull()
    .default(false),
  trialDays: integer("trial_days"),
  trialMinutes: integer("trial_minutes"),
  allowQuantity: boolean("allow_quantity").notNull().default(false),
  minQuantity: integer("min_quantity").notNull().default(1),
  maxQuantity: integer("max_quantity"),
  livemode: boolean("livemode").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
