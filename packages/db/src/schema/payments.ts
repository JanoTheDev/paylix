import { pgTable, uuid, text, integer, boolean, timestamp, bigint, pgEnum, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { products } from "./products";
import { customers } from "./customers";

export const paymentStatusEnum = pgEnum("payment_status", ["pending", "confirmed", "failed"]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    fee: integer("fee").notNull().default(0),
    status: paymentStatusEnum("status").notNull().default("pending"),
    txHash: text("tx_hash"),
    chain: text("chain").notNull().default("base"),
    token: text("token").notNull().default("USDC"),
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    blockNumber: bigint("block_number", { mode: "number" }),
    metadata: jsonb("metadata").$type<Record<string, string>>().default({}),
    refundedCents: integer("refunded_cents").notNull().default(0),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    quantity: integer("quantity").notNull().default(1),
    taxCents: integer("tax_cents").notNull().default(0),
    taxRateBps: integer("tax_rate_bps"),
    taxLabel: text("tax_label"),
    subtotalCents: integer("subtotal_cents"),
    // UTXO-chain support (IDX-04, requested by the non-EVM indexer agent).
    // `amount` is integer cents, which cannot honestly carry a satoshi value:
    // the cents conversion assumes one whole coin == $1.00, which is right for
    // a dollar-pegged stablecoin and wrong for BTC/LTC. `amountSats` keeps the
    // exact on-chain amount in the chain's smallest unit, and the fiat rate
    // snapshot (captured when the buyer is quoted, not when the tx confirms)
    // makes `amount` a real cents figure. NULL for chains whose native unit is
    // already representable in cents.
    amountSats: bigint("amount_sats", { mode: "bigint" }),
    fiatRateCents: integer("fiat_rate_cents"), // cents per 1 whole coin
    fiatRateCapturedAt: timestamp("fiat_rate_captured_at", { withTimezone: true }),
    livemode: boolean("livemode").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Serves both the uniqueness guarantee and the indexer's dedup lookup:
    // every tx_hash predicate in the codebase also constrains `chain`
    // (packages/indexer/src/handlers.ts:203-204, :1141-1142,
    // packages/utxo-indexer/src/db-callbacks.ts:395), so this composite is
    // fully usable and a separate index on tx_hash alone would be pure write
    // amplification.
    uniqueIndex("payments_chain_tx_idx").on(table.chain, table.txHash),
    // Every dashboard/API/export listing is org-scoped, newest first.
    index("payments_org_created_idx").on(table.organizationId, table.createdAt),
    // Customer detail page and portal list by customer, newest first.
    index("payments_customer_idx").on(table.customerId, table.createdAt),
    // Documented listPayments filter, and the overview page's
    // `status = 'confirmed'` aggregates.
    index("payments_org_status_idx").on(table.organizationId, table.status),
    index("payments_product_idx").on(table.productId),
  ]
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
