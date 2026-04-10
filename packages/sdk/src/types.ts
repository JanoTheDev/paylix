export interface PaylixConfig {
  apiKey: string;
  network: "base" | "base-sepolia";
  merchantWallet: string;
  backendUrl: string;
}

export interface CreateCheckoutParams {
  productId: string;
  customerId?: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
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
}

export interface CustomerPortalParams {
  customerId: string;
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
    status: string;
    productName: string;
    nextChargeDate: string | null;
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
