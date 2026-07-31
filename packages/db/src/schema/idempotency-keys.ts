import { pgTable, text, boolean, timestamp, integer, jsonb, index, primaryKey } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<unknown>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    livemode: boolean("livemode").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // (organization_id, key) is the row's logical identity, so make it the
    // primary key rather than a bare unique index — the table previously had
    // no PK at all. apps/web/lib/idempotency.ts:192 uses an untargeted
    // `.onConflictDoNothing()`, which resolves against the PK unchanged.
    primaryKey({ columns: [table.organizationId, table.key] }),
    // expires_at is notNull because rows are meant to be swept; without an
    // index that sweep is a full scan of a table that gains a row per
    // idempotent API request.
    index("idempotency_keys_expires_idx").on(table.expiresAt),
  ],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
