import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { payments } from "./payments";

export const refundStatusEnum = pgEnum("refund_status", [
  "pending",
  "confirmed",
  "failed",
]);

/**
 * Refund ledger. Paylix is non-custodial — the actual USDC movement is
 * a plain merchant-to-buyer ERC20 transfer executed by the merchant's
 * own wallet. The refund row here records the transfer for bookkeeping,
 * webhooks, and dashboard display.
 *
 * Merchant bears the full refund amount (including the 0.5% platform
 * fee paid on the original charge) — Paylix never returns fees.
 */
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    reason: text("reason"),
    txHash: text("tx_hash").notNull(),
    // A tx hash is only unique *per chain*. `payments` already carries `chain`
    // and dedups on (chain, tx_hash); refunds had neither, so a legitimate
    // refund on chain B could be rejected for colliding with one on chain A,
    // and the dashboard could not tell which chain a refund settled on.
    // Backfilled from the parent payment's `chain` by the migration; the
    // default matches payments.chain so existing insert sites keep working.
    networkKey: text("network_key").notNull().default("base"),
    status: refundStatusEnum("status").notNull().default("pending"),
    createdBy: text("created_by"),
    livemode: boolean("livemode").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Unique per (chain, tx hash), mirroring payments_chain_tx_idx. Prevents a
    // merchant reusing one transfer tx for multiple refund rows without
    // rejecting an unrelated refund that happens to collide on another chain.
    uniqueIndex("refunds_network_tx_hash_idx").on(table.networkKey, table.txHash),
    index("refunds_payment_idx").on(table.paymentId),
    index("refunds_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
