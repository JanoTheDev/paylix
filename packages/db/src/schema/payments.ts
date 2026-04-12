import { pgTable, uuid, text, integer, boolean, timestamp, bigint, pgEnum, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { products } from "./products";
import { customers } from "./customers";

export const paymentStatusEnum = pgEnum("payment_status", ["pending", "confirmed", "failed"]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => products.id),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
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
    livemode: boolean("livemode").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("payments_chain_tx_idx").on(table.chain, table.txHash)]
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
