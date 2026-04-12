import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
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
});

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
