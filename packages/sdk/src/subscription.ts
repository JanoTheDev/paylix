import type {
  PaylixConfig,
  CreateSubscriptionParams,
  CreateSubscriptionResult,
  CancelSubscriptionParams,
  UpdateSubscriptionWalletParams,
} from "./types";

export async function createSubscription(
  config: PaylixConfig,
  params: CreateSubscriptionParams
): Promise<CreateSubscriptionResult> {
  const response = await fetch(`${config.backendUrl}/api/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      productId: params.productId,
      customerId: params.customerId,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      merchantWallet: config.merchantWallet,
      type: "subscription",
      metadata: params.metadata,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(`Paylix subscription failed: ${error.error || response.statusText}`);
  }

  return response.json();
}

export async function cancelSubscription(
  config: PaylixConfig,
  params: CancelSubscriptionParams
): Promise<void> {
  const response = await fetch(
    `${config.backendUrl}/api/subscriptions/${params.subscriptionId}/cancel`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(`Paylix cancel failed: ${error.error || response.statusText}`);
  }
}

export async function updateSubscriptionWallet(
  config: PaylixConfig,
  params: UpdateSubscriptionWalletParams
): Promise<void> {
  const response = await fetch(
    `${config.backendUrl}/api/subscriptions/${params.subscriptionId}/update-wallet`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ newWallet: params.newWallet }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(`Paylix wallet update failed: ${error.error || response.statusText}`);
  }
}
