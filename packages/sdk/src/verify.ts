import type { PaylixConfig, VerifyPaymentParams, VerifyPaymentResult } from "./types";

export async function verifyPayment(
  config: PaylixConfig,
  params: VerifyPaymentParams
): Promise<VerifyPaymentResult> {
  const response = await fetch(
    `${config.backendUrl}/api/payments/${params.paymentId}`,
    {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(`Paylix verify failed: ${error.error || response.statusText}`);
  }

  return response.json();
}
