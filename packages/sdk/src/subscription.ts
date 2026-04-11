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
  const body: Record<string, unknown> = {
    productId: params.productId,
    type: "subscription",
  };
  if (params.customerId) body.customerId = params.customerId;
  if (params.successUrl) body.successUrl = params.successUrl;
  if (params.cancelUrl) body.cancelUrl = params.cancelUrl;
  if (params.metadata) body.metadata = params.metadata;
  if (params.networkKey) body.networkKey = params.networkKey;
  if (params.tokenSymbol) body.tokenSymbol = params.tokenSymbol;

  const response = await fetch(`${config.backendUrl}/api/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(`Paylix subscription failed: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  return {
    checkoutUrl: data.checkoutUrl,
    checkoutId: data.checkoutId,
    trialEndsAt: typeof data.trialEndsAt === "string" ? data.trialEndsAt : null,
  };
}

export async function cancelSubscription(
  config: PaylixConfig,
  params: CancelSubscriptionParams
): Promise<void> {
  const response = await fetch(
    `${config.backendUrl}/api/subscriptions/${params.subscriptionId}/cancel-gasless`,
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
