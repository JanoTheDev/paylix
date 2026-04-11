import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { payments } from "./payments";
import { customers } from "./customers";

export const invoiceEmailStatusEnum = pgEnum("invoice_email_status", [
  "pending",
  "sent",
  "failed",
  "skipped",
]);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    hostedToken: text("hosted_token").notNull(),
    number: text("number").notNull(),

    merchantLegalName: text("merchant_legal_name").notNull().default(""),
    merchantAddressLine1: text("merchant_address_line_1").notNull().default(""),
    merchantAddressLine2: text("merchant_address_line_2"),
    merchantCity: text("merchant_city").notNull().default(""),
    merchantPostalCode: text("merchant_postal_code").notNull().default(""),
    merchantCountry: text("merchant_country").notNull().default(""),
    merchantTaxId: text("merchant_tax_id"),
    merchantSupportEmail: text("merchant_support_email").notNull().default(""),
    merchantLogoUrl: text("merchant_logo_url"),
    merchantFooter: text("merchant_footer"),

    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    customerCountry: text("customer_country"),
    customerTaxId: text("customer_tax_id"),
    customerAddress: text("customer_address"),

    currency: text("currency").notNull().default("USDC"),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    taxLabel: text("tax_label"),
    taxRateBps: integer("tax_rate_bps"),
    reverseCharge: boolean("reverse_charge").notNull().default(false),

    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    emailStatus: invoiceEmailStatusEnum("email_status")
      .notNull()
      .default("pending"),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    emailError: text("email_error"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("invoices_payment_idx").on(table.paymentId),
    uniqueIndex("invoices_hosted_token_idx").on(table.hostedToken),
    uniqueIndex("invoices_org_number_idx").on(
      table.organizationId,
      table.number,
    ),
    index("invoices_org_issued_idx").on(table.organizationId, table.issuedAt),
    index("invoices_customer_issued_idx").on(table.customerId, table.issuedAt),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
