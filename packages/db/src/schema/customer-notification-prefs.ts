import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";

export const customerNotificationCategoryEnum = pgEnum(
  "customer_notification_category",
  ["marketing", "trial_reminders", "abandonment", "receipts"],
);

export type CustomerNotificationCategory =
  | "marketing"
  | "trial_reminders"
  | "abandonment"
  | "receipts";

export const CUSTOMER_NOTIFICATION_CATEGORIES: CustomerNotificationCategory[] = [
  "marketing",
  "trial_reminders",
  "abandonment",
  "receipts",
];

/**
 * Customer-level opt-out per notification category. No row = opted in
 * (the default). A row with opted_in=false suppresses emails in that
 * category. Transactional categories (`receipts`) default on and the
 * dashboard warns merchants when a customer explicitly disables them.
 */
export const customerNotificationPreferences = pgTable(
  "customer_notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    category: customerNotificationCategoryEnum("category").notNull(),
    optedIn: boolean("opted_in").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_notif_prefs_unique").on(
      table.customerId,
      table.category,
    ),
  ],
);

export type CustomerNotificationPreference =
  typeof customerNotificationPreferences.$inferSelect;
export type NewCustomerNotificationPreference =
  typeof customerNotificationPreferences.$inferInsert;
