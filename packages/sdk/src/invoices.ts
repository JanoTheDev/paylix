import { request } from "./request";
import type {
  PaylixConfig,
  CreatePortalSessionParams,
  CreatePortalSessionResult,
  ListCustomerInvoicesParams,
  ListCustomerInvoicesResult,
} from "./types";

export async function createPortalSession(
  config: PaylixConfig,
  params: CreatePortalSessionParams,
): Promise<CreatePortalSessionResult> {
  return request<CreatePortalSessionResult>(
    config,
    "GET",
    `/api/customers/${encodeURIComponent(params.customerId)}/portal-url`,
  );
}

export async function listCustomerInvoices(
  config: PaylixConfig,
  params: ListCustomerInvoicesParams,
): Promise<ListCustomerInvoicesResult> {
  return request<ListCustomerInvoicesResult>(
    config,
    "GET",
    `/api/customers/${encodeURIComponent(params.customerId)}/invoices`,
  );
}
