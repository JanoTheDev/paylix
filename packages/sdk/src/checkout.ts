import type { PaylixConfig, CreateCheckoutParams, CreateCheckoutResult } from "./types";

export async function createCheckout(
  config: PaylixConfig,
  params: CreateCheckoutParams
): Promise<CreateCheckoutResult> {
  const body: Record<string, unknown> = {
    productId: params.productId,
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
    throw new Error(`Paylix checkout failed: ${error.error || response.statusText}`);
  }

  return response.json();
}
