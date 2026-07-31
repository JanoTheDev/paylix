import { pgTable, uuid, text, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth";

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  customerId: text("customer_id").notNull(),
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  walletAddress: text("wallet_address"),
  country: text("country"),
  taxId: text("tax_id"),
  source: text("source").notNull().default("checkout"),
  metadata: jsonb("metadata").$type<Record<string, string>>().default({}),
  livemode: boolean("livemode").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  // NOTE: `livemode` is deliberately NOT part of this key (see DB-10). It is
  // the ON CONFLICT target at apps/web/app/api/checkout/[id]/route.ts:239 and
  // apps/web/app/api/checkout/[id]/relay/route.ts:467; widening it without
  // updating those targets breaks checkout with "no unique or exclusion
  // constraint matching the ON CONFLICT specification".
  uniqueIndex("customers_org_customer_idx").on(table.organizationId, table.customerId),
  // Trial anti-abuse dedup runs on every trial checkout and matches on
  // `lower(email)` (apps/web/app/api/checkout/[id]/relay/dedup.ts:61,70), so a
  // plain btree on `email` would never be used.
  //
  // Deliberately a PURE expression index rather than
  // `(organization_id, lower(email))`: drizzle-kit 0.30.6 can round-trip an
  // index whose columns are all expressions, but crashes introspecting a MIXED
  // plain-column + expression index (`expression: null` fails its Zod schema),
  // which would break `db:push` and `drizzle-kit studio` permanently. The
  // dedup subquery still filters organization_id + livemode; Postgres bitmap-ANDs
  // this with customers_org_created_idx.
  index("customers_email_lower_idx").on(sql`lower(${table.email})`),
  // Dashboard customer list: org-scoped, soft-deleted rows excluded,
  // newest first.
  index("customers_org_created_idx").on(table.organizationId, table.createdAt),
]);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
