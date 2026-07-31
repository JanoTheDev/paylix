import { pgTable, uuid, text, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  details: jsonb("details").$type<Record<string, unknown>>().default({}),
  ipAddress: text("ip_address"),
  livemode: boolean("livemode").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // The audit-log viewer always filters (organization_id, livemode) and pages
  // with `order by created_at desc` + a `created_at <` cursor
  // (apps/web/app/api/settings/audit-log/route.ts). This table is append-only
  // and unbounded.
  index("audit_logs_org_created_idx").on(
    table.organizationId,
    table.livemode,
    table.createdAt,
  ),
  index("audit_logs_resource_idx").on(table.resourceType, table.resourceId),
]);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
