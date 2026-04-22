import type { PaylixConfig } from "./types";

async function post<T>(
  config: PaylixConfig,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${config.backendUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "Request failed" }))) as {
      error?: { message?: string } | string;
    };
    const msg =
      typeof err.error === "string"
        ? err.error
        : err.error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export async function extendTrial(
  config: PaylixConfig,
  subscriptionId: string,
  days: number,
): Promise<{ success: true; trialEndsAt: string }> {
  return post(config, `/api/subscriptions/${subscriptionId}/extend-trial`, { days });
}

export async function compCharge(
  config: PaylixConfig,
  subscriptionId: string,
): Promise<{ success: true; paymentId: string; nextChargeDate: string }> {
  return post(config, `/api/subscriptions/${subscriptionId}/comp-charge`, {});
}

export async function rescheduleSubscription(
  config: PaylixConfig,
  subscriptionId: string,
  nextChargeDate: string,
): Promise<{ success: true; nextChargeDate: string }> {
  return post(config, `/api/subscriptions/${subscriptionId}/reschedule`, {
    nextChargeDate,
  });
}
