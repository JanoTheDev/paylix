import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const NOTIFICATION_KINDS = [
  "invoice",
  "trialStarted",
  "trialEndingSoon",
  "trialFailed",
  "subscriptionCreated",
  "subscriptionCancelled",
  "paymentReceipt",
  "pastDue",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type NotificationPreferences = Record<NotificationKind, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  invoice: true,
  trialStarted: true,
  trialEndingSoon: true,
  trialFailed: true,
  subscriptionCreated: true,
  subscriptionCancelled: true,
  paymentReceipt: true,
  pastDue: true,
};

export const merchantProfiles = pgTable("merchant_profiles", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  legalName: text("legal_name").notNull().default(""),
  addressLine1: text("address_line_1").notNull().default(""),
  addressLine2: text("address_line_2"),
  city: text("city").notNull().default(""),
  postalCode: text("postal_code").notNull().default(""),
  country: text("country").notNull().default(""),
  taxId: text("tax_id"),
  supportEmail: text("support_email").notNull().default(""),
  logoUrl: text("logo_url"),
  invoicePrefix: text("invoice_prefix").notNull().default("INV-"),
  invoiceFooter: text("invoice_footer"),
  invoiceSequence: integer("invoice_sequence").notNull().default(0),
  notificationsEnabled: boolean("notifications_enabled")
    .notNull()
    .default(true),
  notificationPreferences: jsonb("notification_preferences")
    .$type<NotificationPreferences>()
    .notNull()
    .default(DEFAULT_NOTIFICATION_PREFERENCES),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type MerchantProfile = typeof merchantProfiles.$inferSelect;
export type NewMerchantProfile = typeof merchantProfiles.$inferInsert;
