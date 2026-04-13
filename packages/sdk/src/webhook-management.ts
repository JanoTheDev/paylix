import type {
  PaylixConfig,
  Webhook,
  CreateWebhookParams,
  UpdateWebhookParams,
} from "./types";

export async function listWebhooks(
  config: PaylixConfig
): Promise<Webhook[]> {
  const res = await fetch(`${config.backendUrl}/api/webhooks`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `Failed to list webhooks (${res.status})`);
  }
  return (await res.json()) as Webhook[];
}

export async function createWebhook(
  config: PaylixConfig,
  params: CreateWebhookParams
): Promise<Webhook> {
  const res = await fetch(`${config.backendUrl}/api/webhooks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `Failed to create webhook (${res.status})`);
  }
  return (await res.json()) as Webhook;
}

export async function getWebhook(
  config: PaylixConfig,
  id: string
): Promise<Webhook> {
  const res = await fetch(`${config.backendUrl}/api/webhooks/${id}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `Webhook not found (${res.status})`);
  }
  return (await res.json()) as Webhook;
}

export async function updateWebhook(
  config: PaylixConfig,
  id: string,
  params: UpdateWebhookParams
): Promise<Webhook> {
  const res = await fetch(`${config.backendUrl}/api/webhooks/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `Failed to update webhook (${res.status})`);
  }
  return (await res.json()) as Webhook;
}

export async function deleteWebhook(
  config: PaylixConfig,
  id: string
): Promise<{ success: true }> {
  const res = await fetch(`${config.backendUrl}/api/webhooks/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `Failed to delete webhook (${res.status})`);
  }
  return (await res.json()) as { success: true };
}
