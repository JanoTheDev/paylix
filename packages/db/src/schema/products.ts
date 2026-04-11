import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { users } from "./users";

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
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
