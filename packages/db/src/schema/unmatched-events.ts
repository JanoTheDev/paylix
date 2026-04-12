import { pgTable, uuid, text, boolean, jsonb, timestamp, bigint, integer } from "drizzle-orm/pg-core";

export const unmatchedEvents = pgTable("unmatched_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  txHash: text("tx_hash").notNull(),
  blockNumber: bigint("block_number", { mode: "number" }),
  logIndex: integer("log_index"),
  payload: jsonb("payload").notNull(),
  attempts: integer("attempts").notNull().default(0),
  livemode: boolean("livemode").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UnmatchedEvent = typeof unmatchedEvents.$inferSelect;
export type NewUnmatchedEvent = typeof unmatchedEvents.$inferInsert;
