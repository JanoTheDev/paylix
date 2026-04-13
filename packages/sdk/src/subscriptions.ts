import type { PaylixConfig, SubscriptionSummary, ListSubscriptionsParams } from "./types";

function buildQuery(params?: ListSubscriptionsParams): string {
  if (!params) return "";
  const qs = new URLSearchParams();
  if (params.customerId) qs.set("customerId", params.customerId);
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.metadata) {
    for (const [k, v] of Object.entries(params.metadata)) {
      qs.set(`metadata[${k}]`, v);
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}

export async function listSubscriptions(
  config: PaylixConfig,
  params?: ListSubscriptionsParams
): Promise<SubscriptionSummary[]> {
  const res = await fetch(`${config.backendUrl}/api/subscriptions${buildQuery(params)}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `Failed to list subscriptions (${res.status})`);
  }
  return (await res.json()) as SubscriptionSummary[];
}

export async function getSubscription(
  config: PaylixConfig,
  id: string
): Promise<SubscriptionSummary> {
  const res = await fetch(`${config.backendUrl}/api/subscriptions/${id}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `Subscription not found (${res.status})`);
  }
  return (await res.json()) as SubscriptionSummary;
}
