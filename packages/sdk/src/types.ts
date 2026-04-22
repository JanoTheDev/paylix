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
  /**
   * Number of units the buyer is purchasing. Requires the product to
   * have `allowQuantity: true`. Defaults to 1. `session.amount` will
   * be `unit_price * quantity`.
   */
  quantity?: number;
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
  /**
   * Number of seats / units the buyer is purchasing. Requires the
   * product to have `allowQuantity: true`. Defaults to 1. Recurring
   * charges run at `unit_price * quantity`.
   */
  quantity?: number;
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

export interface CustomerInfo {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  walletAddress: string | null;
}

export interface ListPaymentsParams {
  /** Filter by customer ID (the Paylix-generated customer identifier). */
  customerId?: string;
  /** Filter by payment status. */
  status?: "pending" | "confirmed" | "failed";
  /** Filter by metadata key-value pairs. Only payments whose metadata
   *  contains all specified entries are returned (AND logic). */
  metadata?: Record<string, string>;
  /** Max results (1-100, default 100). */
  limit?: number;
}

export interface PaymentSummary {
  id: string;
  amount: number;
  fee: number;
  status: "pending" | "confirmed" | "failed";
  txHash: string | null;
  chain: string;
  token: string;
  productId: string;
  fromAddress: string | null;
  toAddress: string | null;
  metadata: Record<string, string>;
  livemode: boolean;
  createdAt: string;
  customer: CustomerInfo;
}

export interface ListSubscriptionsParams {
  /** Filter by customer ID (the Paylix-generated customer identifier). */
  customerId?: string;
  /** Filter by subscription status. */
  status?: SubscriptionStatus;
  /** Filter by metadata key-value pairs (AND logic). */
  metadata?: Record<string, string>;
  /** Max results (1-100, default 100). */
  limit?: number;
}

export interface SubscriptionSummary {
  id: string;
  status: SubscriptionStatus;
  subscriberAddress: string;
  networkKey: string;
  tokenSymbol: string;
  onChainId: string | null;
  intervalSeconds: number | null;
  nextChargeDate: string | null;
  trialEndsAt: string | null;
  pausedAt: string | null;
  productId: string;
  productName: string;
  metadata: Record<string, string>;
  livemode: boolean;
  createdAt: string;
  customer: CustomerInfo;
}

export interface Webhook {
  id: string;
  organizationId: string;
  url: string;
  events: string[];
  isActive: boolean;
  livemode: boolean;
  createdAt: string;
  secret?: string;
}

export interface CreateWebhookParams {
  url: string;
  events: string[];
}

export interface UpdateWebhookParams {
  url?: string;
  events?: string[];
  isActive?: boolean;
}

export interface WebhookVerifyParams {
  payload: string | Buffer;
  signature: string;
  secret: string;
  /** Max age in seconds for a timestamped signature. Default 300 (5 min). */
  maxAgeSeconds?: number;
  /** Override "now" for tests; defaults to Date.now() / 1000. */
  nowSeconds?: number;
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

export interface CreateCustomerParams {
  firstName?: string;
  lastName?: string;
  email?: string;
  walletAddress?: string;
  country?: string;
  taxId?: string;
  metadata?: Record<string, string>;
}

export interface UpdateCustomerParams {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  walletAddress?: string | null;
  phone?: string | null;
  country?: string | null;
  taxId?: string | null;
  metadata?: Record<string, string>;
}

export interface Customer {
  id: string;
  customerId: string;
  organizationId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  walletAddress: string | null;
  country: string | null;
  taxId: string | null;
  source: string;
  metadata: Record<string, string>;
  deletedAt: string | null;
  createdAt: string;
}

export interface CustomerDetail {
  customer: Customer;
  payments: Array<{
    id: string;
    amount: number;
    fee: number;
    status: string;
    txHash: string | null;
    createdAt: string;
    productName: string | null;
    productType: string | null;
    metadata: Record<string, string>;
  }>;
  subscriptions: Array<{
    id: string;
    status: SubscriptionStatus;
    createdAt: string;
    nextChargeDate: string | null;
    trialEndsAt: string | null;
    productName: string | null;
    metadata: Record<string, string>;
  }>;
  invoices: Array<{
    id: string;
    number: string;
    totalCents: number;
    currency: string;
    issuedAt: string;
    emailStatus: string;
    hostedToken: string;
  }>;
}

export interface CreateProductParams {
  name: string;
  description?: string;
  type: "one_time" | "subscription";
  billingInterval?: "minutely" | "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
  prices: Array<{
    networkKey: string;
    tokenSymbol: string;
    amount: string;
  }>;
  trialDays?: number;
  trialMinutes?: number;
  taxRateBps?: number | null;
  taxLabel?: string | null;
  reverseChargeEligible?: boolean;
  checkoutFields?: {
    firstName?: boolean;
    lastName?: boolean;
    email?: boolean;
    phone?: boolean;
  };
  metadata?: Record<string, string>;
}

export interface UpdateProductParams {
  name?: string;
  description?: string;
  type?: "one_time" | "subscription";
  billingInterval?: "minutely" | "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | null;
  prices?: Array<{
    networkKey: string;
    tokenSymbol: string;
    amount: string;
  }>;
  trialDays?: number | null;
  trialMinutes?: number | null;
  taxRateBps?: number | null;
  taxLabel?: string | null;
  reverseChargeEligible?: boolean;
  checkoutFields?: {
    firstName?: boolean;
    lastName?: boolean;
    email?: boolean;
    phone?: boolean;
  };
  metadata?: Record<string, string>;
}

export interface Product {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  type: "one_time" | "subscription";
  billingInterval: string | null;
  trialDays: number | null;
  trialMinutes: number | null;
  isActive: boolean;
  taxRateBps: number | null;
  taxLabel: string | null;
  reverseChargeEligible: boolean;
  checkoutFields: Record<string, boolean>;
  metadata: Record<string, string>;
  createdAt: string;
  prices?: Array<{
    id: string;
    productId: string;
    networkKey: string;
    tokenSymbol: string;
    amount: string;
    isActive: boolean;
  }>;
}
