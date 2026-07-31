/**
 * Lifecycle of a subscription.
 *
 * Mirrors the `subscription_status` Postgres enum in
 * `packages/db/src/schema/subscriptions.ts`. The SDK is monorepo-dependency
 * free by design, so this union is a hand-maintained copy — if you add a
 * value to the database enum, add it here too and update
 * `__tests__/enums.test.ts`, which asserts the two lists match.
 *
 * - `active` — billing normally.
 * - `paused` — collection suspended by the merchant; no charges attempted.
 * - `past_due` — a charge failed; the keeper is retrying.
 * - `cancelled` — ended by the merchant or the customer.
 * - `expired` — reached its natural end (e.g. a gift subscription lapsed).
 * - `trialing` — inside a free trial; nothing has been charged yet.
 * - `trial_conversion_failed` — the trial ended but the first on-chain
 *   charge could not be relayed.
 */
export type SubscriptionStatus =
  | "active"
  | "paused"
  | "past_due"
  | "cancelled"
  | "expired"
  | "trialing"
  | "trial_conversion_failed";

/**
 * Settlement state of a payment. Mirrors the `payment_status` enum in
 * `packages/db/src/schema/payments.ts`.
 */
export type PaymentStatus = "pending" | "confirmed" | "failed";

/**
 * Billing cadence of a subscription product. Mirrors the `billing_interval`
 * enum in `packages/db/src/schema/products.ts`. `minutely` exists for
 * end-to-end testing and should not be used in production.
 */
export type BillingInterval =
  | "minutely"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "yearly";

/**
 * Product kind. Mirrors the `product_type` enum in
 * `packages/db/src/schema/products.ts`.
 */
export type ProductType = "one_time" | "subscription";

/**
 * Delivery state of the emailed invoice. Mirrors the
 * `invoice_email_status` enum in `packages/db/src/schema/invoices.ts`.
 */
export type InvoiceEmailStatus = "pending" | "sent" | "failed" | "skipped";

/**
 * Supported network keys. Must stay in sync with the server-side registry
 * at `packages/config/src/network-registry.ts`. The SDK has no runtime dep
 * on the config package (it's consumer-published); adding a chain means
 * extending this union and adding a row to `./networks.ts`.
 */
export type PaylixNetwork =
  | "ethereum"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon"
  | "bnb"
  | "avalanche"
  | "ethereum-sepolia"
  | "base-sepolia"
  | "arbitrum-sepolia"
  | "op-sepolia"
  | "polygon-amoy"
  | "bnb-testnet"
  | "avalanche-fuji"
  | "solana"
  | "solana-devnet"
  | "bitcoin"
  | "bitcoin-testnet"
  | "litecoin"
  | "litecoin-testnet";

export interface PaylixConfig {
  /**
   * Your API key.
   *
   * **Use an `sk_` secret key.** Every method on the `Paylix` class talks to
   * an authenticated merchant endpoint, so this SDK is server-side only —
   * load the key from an environment variable and never ship it in a
   * browser bundle, a mobile app, or a client component. `pk_` publishable
   * keys are the client-safe half of the pair, but they are rate-limited and
   * rejected by the endpoints this SDK calls.
   */
  apiKey: string;
  /**
   * Optional default network. Only used by the `network` accessor for
   * explorer/RPC metadata; it does **not** select the chain for a checkout —
   * pass `networkKey` per call for that. Omit it entirely if you run on a
   * chain this SDK version does not list.
   */
  network?: PaylixNetwork;
  /** Base URL of your Paylix deployment, e.g. `https://pay.example.com`. */
  backendUrl: string;
  /**
   * Abort a request that has not responded within this many milliseconds.
   * Default 30 000. Node's `fetch` has no timeout of its own, so without
   * this a hung backend hangs your process.
   */
  timeoutMs?: number;
  /**
   * Extra attempts after the first failure. Default 2. Retries fire on 429,
   * on 5xx, and on network errors — but only for idempotent verbs and for
   * `POST`s, which the SDK sends with an auto-generated `Idempotency-Key`
   * so a replay cannot double-charge. Backoff is exponential with jitter
   * and honours `Retry-After`. Set to `0` to disable.
   */
  maxRetries?: number;
  /**
   * Override the `fetch` implementation — useful for proxies, custom
   * agents, and tests. Defaults to `globalThis.fetch`.
   */
  fetch?: typeof fetch;
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

/**
 * Parameters for `createSubscription`. Structurally identical to
 * {@link CreateCheckoutParams} — both create a checkout session against
 * the same endpoint; only the product's `type` decides whether the result
 * is a one-time charge or a recurring one. `quantity` means "seats" here.
 */
export type CreateSubscriptionParams = CreateCheckoutParams;

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

/**
 * Payload of `GET /api/payments/{id}` — the shape returned by both
 * {@link Paylix.verifyPayment} and {@link Paylix.getPayment}.
 *
 * This is deliberately narrower than {@link PaymentSummary}, which the
 * *list* endpoint returns: there is no `id`, `token`, `fromAddress`,
 * `toAddress`, `createdAt`, or `customer` object here. Use `listPayments`
 * when you need those.
 */
export interface VerifyPaymentResult {
  /** `true` only when the payment is `confirmed` **and** has a tx hash. */
  verified: boolean;
  /** Integer cents. `1000` = $10.00. */
  amount: number;
  /** Platform fee, integer cents. */
  fee: number;
  txHash: string | null;
  /** Network key the payment settled on, e.g. `"base"`. */
  chain: string;
  /** Your external customer identifier, not the Paylix customer UUID. */
  customerId: string;
  productId: string;
  status: PaymentStatus;
  metadata: Record<string, string>;
  /** `false` for payments made with a test-mode key. */
  livemode: boolean;
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
  emailStatus: InvoiceEmailStatus;
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
  status?: PaymentStatus;
  /** Filter by metadata key-value pairs. Only payments whose metadata
   *  contains all specified entries are returned (AND logic). */
  metadata?: Record<string, string>;
  /** Max results (1-100, default 100). */
  limit?: number;
}

/**
 * A row from `listPayments`. Amounts are integer cents (`1000` = $10.00).
 *
 * Note that the single-payment endpoint returns the narrower
 * {@link VerifyPaymentResult}, not this type.
 */
export interface PaymentSummary {
  id: string;
  amount: number;
  fee: number;
  status: PaymentStatus;
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
  /**
   * The **raw** request body, exactly as received. Do not re-serialize a
   * parsed object — key order changes invalidate the signature.
   *
   * Typed `Uint8Array` rather than `Buffer` so consumers do not need
   * `@types/node`; a Node `Buffer` is a `Uint8Array` and passes as-is.
   */
  payload: string | Uint8Array;
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

/**
 * Read-only display metadata for a network: enough to build an explorer
 * link or pick a public RPC, and nothing else.
 *
 * Contract addresses are deliberately absent. The backend is the only
 * authority on which `PaymentVault` / `SubscriptionManager` a deployment
 * uses (they come from `${CHAIN}_PAYMENT_VAULT` / `_SUBSCRIPTION_MANAGER`
 * env vars), and shipping a placeholder here previously meant
 * `NETWORKS.base.paymentVaultAddress` returned the zero address — a
 * valid-looking value that burns funds.
 */
export type NetworkConfig = {
  /** EVM chain ID. `0` for non-EVM chains (Solana, Bitcoin, Litecoin). */
  chainId: number;
  /** Whether the chain speaks EVM JSON-RPC. Narrow on this before using `chainId`. */
  isEvm: boolean;
  /** Public RPC endpoint. Empty string where the SDK has no default. */
  rpcUrl: string;
  /**
   * Canonical USDC contract on this chain, or `null` where Paylix has no
   * canonical stablecoin address (all testnets, and every non-EVM chain).
   */
  usdcAddress: string | null;
  /** Base URL of the chain's block explorer. */
  explorerUrl: string;
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
  type: ProductType;
  billingInterval?: BillingInterval;
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
  type?: ProductType;
  billingInterval?: BillingInterval | null;
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
  type: ProductType;
  billingInterval: BillingInterval | null;
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
