import { request } from "./request";
import type {
  PaylixConfig,
  Webhook,
  CreateWebhookParams,
  UpdateWebhookParams,
} from "./types";

export async function listWebhooks(config: PaylixConfig): Promise<Webhook[]> {
  return request<Webhook[]>(config, "GET", "/api/webhooks");
}

export async function createWebhook(
  config: PaylixConfig,
  params: CreateWebhookParams,
): Promise<Webhook> {
  return request<Webhook>(config, "POST", "/api/webhooks", { body: params });
}

export async function getWebhook(
  config: PaylixConfig,
  id: string,
): Promise<Webhook> {
  return request<Webhook>(
    config,
    "GET",
    `/api/webhooks/${encodeURIComponent(id)}`,
  );
}

export async function updateWebhook(
  config: PaylixConfig,
  id: string,
  params: UpdateWebhookParams,
): Promise<Webhook> {
  return request<Webhook>(
    config,
    "PATCH",
    `/api/webhooks/${encodeURIComponent(id)}`,
    { body: params },
  );
}

export async function deleteWebhook(
  config: PaylixConfig,
  id: string,
): Promise<{ success: true }> {
  return request<{ success: true }>(
    config,
    "DELETE",
    `/api/webhooks/${encodeURIComponent(id)}`,
  );
}

export interface ReplayWebhookDeliveryResult {
  deliveryId: string;
  status: "delivered" | "failed";
  httpStatus?: number;
  error?: string;
}

export async function replayWebhookDelivery(
  config: PaylixConfig,
  deliveryId: string,
): Promise<ReplayWebhookDeliveryResult> {
  return request<ReplayWebhookDeliveryResult>(
    config,
    "POST",
    `/api/webhooks/deliveries/${encodeURIComponent(deliveryId)}/replay`,
  );
}

export interface SendTestWebhookResult {
  deliveryId: string;
  eventId: string;
  status: "delivered" | "failed";
  httpStatus?: number;
  error?: string;
}

export async function sendTestWebhook(
  config: PaylixConfig,
  webhookId: string,
  event: string,
): Promise<SendTestWebhookResult> {
  return request<SendTestWebhookResult>(
    config,
    "POST",
    `/api/webhooks/${encodeURIComponent(webhookId)}/send-test`,
    { body: { event } },
  );
}
