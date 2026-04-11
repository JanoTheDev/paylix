export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "cancelled"
  | "expired"
  | "trialing"
  | "trial_conversion_failed";

export interface PaylixConfig {
  apiKey: string;
  network: "base" | "base-sepolia";
  backendUrl: string;
}

export interface CreateCheckoutParams {
  productId: string;
  customerId?: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
  /**
   * Optional: pre-lock the session to a specific (network, token). If
   * omitted, the session starts in "awaiting_currency" state and the
   * buyer picks on the checkout page.
   *
   * Valid network keys depend on which networks the Paylix instance has
   * configured — the SDK does not validate them client-side. If you pass
   * an unsupported value, the server returns 400.
   */
  networkKey?: string;
  tokenSymbol?: string;
}

export interface CreateCheckoutResult {
  checkoutUrl: string;
  checkoutId: string;
}

export interface CreateSubscriptionParams {
  productId: string;
  customerId?: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
  /**
   * Optional: pre-lock the session to a specific (network, token). If
   * omitted, the session starts in "awaiting_currency" state and the
   * buyer picks on the checkout page.
   *
   * Valid network keys depend on which networks the Paylix instance has
   * configured — the SDK does not validate them client-side. If you pass
   * an unsupported value, the server returns 400.
   */
  networkKey?: string;
  tokenSymbol?: string;
}

/**
 * Result returned from `createSubscription`.
 *
 * Note: `checkoutId` is the ID of the Paylix checkout session, not the
 * on-chain subscription ID. The actual subscription ID is assigned on-chain
 * when the customer completes the payment flow, and is delivered
 * asynchronously via the `subscription.created` webhook.
 */
export interface CreateSubscriptionResult {
  checkoutUrl: string;
  checkoutId: string;
  /** ISO-8601 timestamp if the underlying product has a trial period. */
  trialEndsAt: string | null;
}

export interface CancelSubscriptionParams {
  subscriptionId: string;
}

export interface UpdateSubscriptionWalletParams {
  subscriptionId: string;
  newWallet: string;
}

export interface VerifyPaymentParams {
  paymentId: string;
}

export interface VerifyPaymentResult {
  verified: boolean;
  amount: number;
  fee: number;
  txHash: string | null;
  chain: string;
  customerId: string;
  productId: string;
  status: "pending" | "confirmed" | "failed";
  metadata: Record<string, string>;
}

export interface CustomerPortalParams {
  customerId: string;
}

export interface CreatePortalSessionParams {
  customerId: string;
}

export interface CreatePortalSessionResult {
  /** Signed, time-limited URL you can redirect the customer to. */
  url: string;
}

export interface ListCustomerInvoicesParams {
  customerId: string;
}

export interface CustomerInvoice {
  id: string;
  number: string;
  totalCents: number;
  subtotalCents: number;
  taxCents: number;
  taxLabel: string | null;
  currency: string;
  issuedAt: string;
  emailStatus: "pending" | "sent" | "failed" | "skipped";
  /** Public hosted HTML page a customer can bookmark. */
  hostedUrl: string;
  /** On-demand invoice PDF download. */
  invoicePdfUrl: string;
  /** On-demand payment receipt PDF download. */
  receiptPdfUrl: string;
}

export interface ListCustomerInvoicesResult {
  invoices: CustomerInvoice[];
}

export interface CustomerPortalResult {
  customer: {
    id: string;
    customerId: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    walletAddress: string | null;
  };
  payments: Array<{
    id: string;
    amount: number;
    status: string;
    txHash: string | null;
    createdAt: string;
    productName: string;
  }>;
  subscriptions: Array<{
    id: string;
    status: SubscriptionStatus;
    productName: string;
    nextChargeDate: string | null;
    trialEndsAt: string | null;
    createdAt: string;
  }>;
}

export interface WebhookVerifyParams {
  payload: string | Buffer;
  signature: string;
  secret: string;
}

export interface WebhookEvent {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export type NetworkConfig = {
  chainId: number;
  rpcUrl: string;
  paymentVaultAddress: string;
  subscriptionManagerAddress: string;
  usdcAddress: string;
  basescanUrl: string;
};
