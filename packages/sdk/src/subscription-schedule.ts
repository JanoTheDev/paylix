import type { PaylixConfig } from "./types";

export interface GiftSubscriptionParams {
  productId: string;
  customerId: string;
  expiresAt?: string;
  metadata?: Record<string, string>;
}

export interface GiftedSubscription {
  id: string;
  productId: string;
  customerId: string;
  status: string;
  isGift: boolean;
  giftExpiresAt: string | null;
  createdAt: string;
}

export async function giftSubscription(
  config: PaylixConfig,
  params: GiftSubscriptionParams,
): Promise<GiftedSubscription> {
  const res = await fetch(`${config.backendUrl}/api/subscriptions/gift`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string } | string;
    };
    const msg =
      typeof body.error === "string"
        ? body.error
        : body.error?.message ?? res.statusText;
    throw new Error(`Paylix gift subscription failed: ${msg}`);
  }
  return (await res.json()) as GiftedSubscription;
}

export type CancelWhen = "immediate" | "period_end";

/**
 * Schedule a cancellation at the end of the current billing period.
 * Subscription stays `active` until next_charge_date; keeper flips it
 * to `cancelled` then. Use `resumeSubscriptionSchedule` to undo before
 * the boundary passes.
 */
export async function scheduleSubscriptionCancellation(
  config: PaylixConfig,
  subscriptionId: string,
): Promise<{ cancelAt: string }> {
  const res = await fetch(
    `${config.backendUrl}/api/subscriptions/${subscriptionId}/cancel`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ when: "period_end" }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string } | string;
    };
    const msg =
      typeof body.error === "string"
        ? body.error
        : body.error?.message ?? res.statusText;
    throw new Error(`Paylix schedule cancel failed: ${msg}`);
  }
  return (await res.json()) as { cancelAt: string };
}

export async function resumeSubscriptionSchedule(
  config: PaylixConfig,
  subscriptionId: string,
): Promise<void> {
  const res = await fetch(
    `${config.backendUrl}/api/subscriptions/${subscriptionId}/resume-schedule`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
    },
  );
  if (!res.ok) {
    throw new Error(`Paylix resume schedule failed: ${res.statusText}`);
  }
}
