import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customers } from "./customers";

/**
 * Per-customer wallet list. Replaces the single
 * customers.walletAddress — we keep that column for back-compat on
 * existing reads but all new logic should route through here.
 *
 * Keeper uses these (ordered by is_primary desc, created_at asc) to
 * attempt a backup charge when the primary wallet has insufficient
 * USDC allowance / balance. One row per customer is marked primary;
 * the partial unique index enforces that invariant.
 */
export const customerWallets = pgTable(
  "customer_wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    nickname: text("nickname"),
    isPrimary: boolean("is_primary").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_wallets_addr_idx").on(
      table.customerId,
      table.address,
    ),
    uniqueIndex("customer_wallets_primary_idx")
      .on(table.customerId)
      .where(sql`is_primary = true`),
    index("customer_wallets_customer_idx").on(table.customerId),
  ],
);

export type CustomerWallet = typeof customerWallets.$inferSelect;
export type NewCustomerWallet = typeof customerWallets.$inferInsert;
