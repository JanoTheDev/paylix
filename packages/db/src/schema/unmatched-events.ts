import { pgTable, uuid, text, boolean, jsonb, timestamp, bigint, integer, unique, index } from "drizzle-orm/pg-core";

export const unmatchedEvents = pgTable("unmatched_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  txHash: text("tx_hash").notNull(),
  blockNumber: bigint("block_number", { mode: "number" }),
  logIndex: integer("log_index"),
  payload: jsonb("payload").notNull(),
  attempts: integer("attempts").notNull().default(0),
  // Exponential-backoff cursor for the retry sweep (IDX-26, requested by the
  // EVM indexer agent). Without it every retained event is replayed on every
  // 30s pass regardless of how often it has already failed.
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  // Terminal state so a permanently unmatchable event (e.g. its checkout
  // session was removed by an org cascade) is operator-visible rather than
  // only being excluded by the attempt ceiling. "pending" | "abandoned".
  status: text("status").notNull().default("pending"),
  livemode: boolean("livemode").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // An on-chain log is uniquely identified by (tx_hash, log_index, event_type).
  // Without this, an indexer restart, a reorg, or an overlapping block range
  // re-inserts the same event and the retry loop processes it twice — which,
  // because the retry path creates payment rows, can produce DUPLICATE
  // PAYMENTS. Retention without dedup is worse than dropping.
  //
  // nullsNotDistinct(): log_index is nullable, and Postgres treats NULLs as
  // distinct by default, which would let unbounded duplicates through for any
  // event recorded without one. Requires Postgres 15+. Declared as a UNIQUE
  // CONSTRAINT rather than a unique index because drizzle only exposes
  // NULLS NOT DISTINCT on constraints.
  unique("unmatched_events_dedup_idx")
    .on(table.txHash, table.logIndex, table.eventType)
    .nullsNotDistinct(),
  // The retry loop scans in FIFO order.
  index("unmatched_events_created_idx").on(table.createdAt),
  // FORWARD-LOOKING — currently unused. Intended for the backoff-aware sweep
  // `where status = 'pending' and next_attempt_at <= now()`. The retry scan in
  // packages/indexer/src/handlers.ts still filters on `attempts` and orders by
  // `created_at`, so nothing selects on these columns yet; the index only starts
  // paying for itself once IDX-26 lands (see audit/_schema-followups.md §B).
  index("unmatched_events_retry_idx").on(table.status, table.nextAttemptAt),
]);

export type UnmatchedEvent = typeof unmatchedEvents.$inferSelect;
export type NewUnmatchedEvent = typeof unmatchedEvents.$inferInsert;
