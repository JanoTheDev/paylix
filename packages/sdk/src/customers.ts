import { request } from "./request";
import type {
  PaylixConfig,
  CreateCustomerParams,
  UpdateCustomerParams,
  Customer,
  CustomerDetail,
} from "./types";

export async function createCustomer(
  config: PaylixConfig,
  params: CreateCustomerParams,
): Promise<Customer> {
  const data = await request<{ customer: Customer }>(
    config,
    "POST",
    "/api/customers",
    { body: params },
  );
  return data.customer;
}

export async function getCustomer(
  config: PaylixConfig,
  id: string,
): Promise<CustomerDetail> {
  return request<CustomerDetail>(
    config,
    "GET",
    `/api/customers/${encodeURIComponent(id)}`,
  );
}

export async function updateCustomer(
  config: PaylixConfig,
  id: string,
  params: UpdateCustomerParams,
): Promise<Customer> {
  const data = await request<{ customer: Customer }>(
    config,
    "PATCH",
    `/api/customers/${encodeURIComponent(id)}`,
    { body: params },
  );
  return data.customer;
}

export async function deleteCustomer(
  config: PaylixConfig,
  id: string,
): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    config,
    "POST",
    `/api/customers/${encodeURIComponent(id)}/delete`,
  );
}
