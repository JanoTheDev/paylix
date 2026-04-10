import type { PaylixConfig, CustomerPortalParams, CustomerPortalResult } from "./types";

export async function getCustomerPortal(
  config: PaylixConfig,
  params: CustomerPortalParams
): Promise<CustomerPortalResult> {
  const response = await fetch(
    `${config.backendUrl}/api/customers/${params.customerId}`,
    {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(`Paylix portal failed: ${error.error || response.statusText}`);
  }

  return response.json();
}
