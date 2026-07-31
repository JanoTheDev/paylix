import { request } from "./request";
import type { PaylixConfig, PaymentStatus } from "./types";

export interface RefundPaymentParams {
  paymentId: string;
  /** Integer cents. `1000` = $10.00. Must not exceed the unrefunded balance. */
  amount: number;
  /**
   * 0x-prefixed 32-byte hex of the merchant → buyer transfer you already
   * broadcast. Paylix is non-custodial: it records the refund, it does not
   * move funds. Send the tokens first, then call this.
   */
  txHash: string;
  /** Free-text note stored on the refund and included in the webhook. */
  reason?: string;
}

export interface Refund {
  id: string;
  paymentId: string;
  /** Integer cents. */
  amount: number;
  reason: string | null;
  txHash: string;
  status: PaymentStatus;
  createdAt: string;
}

/**
 * Records a refund against a payment.
 *
 * This does **not** transfer tokens — broadcast the merchant → buyer
 * transfer yourself and pass its `txHash`. The indexer confirms the hash
 * on-chain and flips the refund to `confirmed`.
 */
export async function refundPayment(
  config: PaylixConfig,
  params: RefundPaymentParams,
): Promise<Refund> {
  const { paymentId, ...body } = params;
  return request<Refund>(
    config,
    "POST",
    `/api/payments/${encodeURIComponent(paymentId)}/refund`,
    { body },
  );
}
