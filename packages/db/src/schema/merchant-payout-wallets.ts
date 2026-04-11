import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Per-merchant per-network payout wallet configuration.
 *
 * Three-state model:
 *   - row missing              → network not configured (implicitly disabled)
 *   - enabled=true, addr NULL  → use merchant's default wallet from users.walletAddress
 *   - enabled=true, addr 0x..  → use this override address for the network
 *   - enabled=false            → network disabled, even if the merchant had an override
 *
 * wallet_address is nullable ON PURPOSE — see spec §Data Model.
 */
export const merchantPayoutWallets = pgTable(
  "merchant_payout_wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    networkKey: text("network_key").notNull(),
    walletAddress: text("wallet_address"), // nullable: NULL means "use default"
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("merchant_payout_wallets_unique").on(t.userId, t.networkKey)],
);

export type MerchantPayoutWallet = typeof merchantPayoutWallets.$inferSelect;
export type NewMerchantPayoutWallet =
  typeof merchantPayoutWallets.$inferInsert;
