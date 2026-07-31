import { request } from "./request";
import type { PaylixConfig, VerifyPaymentParams, VerifyPaymentResult } from "./types";

export async function verifyPayment(
  config: PaylixConfig,
  params: VerifyPaymentParams,
): Promise<VerifyPaymentResult> {
  return request<VerifyPaymentResult>(
    config,
    "GET",
    `/api/payments/${encodeURIComponent(params.paymentId)}`,
  );
}
