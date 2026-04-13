import { pgTable, text, boolean, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
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
  (table) => [uniqueIndex("idempotency_keys_org_key_idx").on(table.organizationId, table.key)],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
