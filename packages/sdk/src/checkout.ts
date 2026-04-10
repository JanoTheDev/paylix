import type { PaylixConfig, CreateCheckoutParams, CreateCheckoutResult } from "./types";

export async function createCheckout(
  config: PaylixConfig,
  params: CreateCheckoutParams
): Promise<CreateCheckoutResult> {
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
      metadata: params.metadata,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(`Paylix checkout failed: ${error.error || response.statusText}`);
  }

  return response.json();
}
