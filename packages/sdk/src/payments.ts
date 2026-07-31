import { buildQuery, request } from "./request";
import type {
  PaylixConfig,
  PaymentSummary,
  ListPaymentsParams,
  VerifyPaymentResult,
} from "./types";

export async function listPayments(
  config: PaylixConfig,
  params?: ListPaymentsParams,
): Promise<PaymentSummary[]> {
  return request<PaymentSummary[]>(config, "GET", "/api/payments", {
    query: buildQuery(params),
  });
}

/**
 * Fetches one payment.
 *
 * Returns {@link VerifyPaymentResult} — the same narrow verification shape
 * `verifyPayment` returns, because both hit `GET /api/payments/{id}`. It
 * does **not** include `id`, `token`, `fromAddress`, `toAddress`,
 * `createdAt`, or a `customer` object; use `listPayments` for those.
 */
export async function getPayment(
  config: PaylixConfig,
  id: string,
): Promise<VerifyPaymentResult> {
  return request<VerifyPaymentResult>(
    config,
    "GET",
    `/api/payments/${encodeURIComponent(id)}`,
  );
}
