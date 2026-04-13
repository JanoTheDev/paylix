import type { PaylixConfig, PaymentSummary, ListPaymentsParams } from "./types";

function buildQuery(params?: ListPaymentsParams): string {
  if (!params) return "";
  const qs = new URLSearchParams();
  if (params.customerId) qs.set("customerId", params.customerId);
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.metadata) {
    for (const [k, v] of Object.entries(params.metadata)) {
      qs.set(`metadata[${k}]`, v);
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}

export async function listPayments(
  config: PaylixConfig,
  params?: ListPaymentsParams
): Promise<PaymentSummary[]> {
  const res = await fetch(`${config.backendUrl}/api/payments${buildQuery(params)}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `Failed to list payments (${res.status})`);
  }
  return (await res.json()) as PaymentSummary[];
}

export async function getPayment(
  config: PaylixConfig,
  id: string
): Promise<PaymentSummary> {
  const res = await fetch(`${config.backendUrl}/api/payments/${id}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `Payment not found (${res.status})`);
  }
  return (await res.json()) as PaymentSummary;
}
