import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { invoices } from "./invoices";

export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitAmountCents: integer("unit_amount_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    livemode: boolean("livemode").notNull().default(false),
  },
  (table) => [index("invoice_line_items_invoice_idx").on(table.invoiceId)],
);

export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type NewInvoiceLineItem = typeof invoiceLineItems.$inferInsert;
