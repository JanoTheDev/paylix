import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { webhooks } from "./webhooks";

export const deliveryStatusEnum = pgEnum("delivery_status", ["pending", "delivered", "failed"]);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  webhookId: uuid("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").notNull(),
  status: deliveryStatusEnum("status").notNull().default("pending"),
  httpStatus: integer("http_status"),
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  livemode: boolean("livemode").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Retry worker loop: `where status = 'failed' and next_retry_at <= now()
  // and attempts < 5` (packages/indexer/src/webhook-dispatch.ts). This table
  // grows monotonically with every webhook ever sent, so an unindexed scan
  // costs more every day.
  index("webhook_deliveries_retry_idx").on(table.status, table.nextRetryAt),
  // Delivery-history UI and replay: `where webhook_id = ? order by
  // created_at desc`.
  index("webhook_deliveries_webhook_created_idx").on(
    table.webhookId,
    table.createdAt,
  ),
  // packages/indexer/src/alerts.ts aggregates the last hour by created_at.
  index("webhook_deliveries_created_idx").on(table.createdAt),
]);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
