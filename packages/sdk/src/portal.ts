import { request } from "./request";
import type { PaylixConfig, CustomerPortalParams, CustomerPortalResult } from "./types";

export async function getCustomerPortal(
  config: PaylixConfig,
  params: CustomerPortalParams,
): Promise<CustomerPortalResult> {
  return request<CustomerPortalResult>(
    config,
    "GET",
    `/api/customers/${encodeURIComponent(params.customerId)}`,
  );
}
