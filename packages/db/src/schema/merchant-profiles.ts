import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

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
