import { request } from "./request";
import type { PaylixConfig, CreateCheckoutParams, CreateCheckoutResult } from "./types";

/**
 * Builds the `POST /api/checkout` body shared by one-time checkouts and
 * subscriptions. Only defined keys are sent so the server's defaults apply.
 */
export function buildCheckoutBody(
  params: CreateCheckoutParams,
  type?: "subscription",
): Record<string, unknown> {
  const body: Record<string, unknown> = { productId: params.productId };
  if (type) body.type = type;
  if (params.customerId) body.customerId = params.customerId;
  if (params.successUrl) body.successUrl = params.successUrl;
  if (params.cancelUrl) body.cancelUrl = params.cancelUrl;
  if (params.metadata) body.metadata = params.metadata;
  if (params.networkKey) body.networkKey = params.networkKey;
  if (params.tokenSymbol) body.tokenSymbol = params.tokenSymbol;
  if (params.quantity !== undefined) body.quantity = params.quantity;
  return body;
}

export async function createCheckout(
  config: PaylixConfig,
  params: CreateCheckoutParams,
): Promise<CreateCheckoutResult> {
  return request<CreateCheckoutResult>(config, "POST", "/api/checkout", {
    body: buildCheckoutBody(params),
  });
}
