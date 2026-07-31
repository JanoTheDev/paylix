import type {
  PaylixConfig,
  CreateCheckoutParams,
  CreateCheckoutResult,
  CreateSubscriptionParams,
  CreateSubscriptionResult,
  CancelSubscriptionParams,
  UpdateSubscriptionWalletParams,
  VerifyPaymentParams,
  VerifyPaymentResult,
  CustomerPortalParams,
  CustomerPortalResult,
  CreatePortalSessionParams,
  CreatePortalSessionResult,
  ListCustomerInvoicesParams,
  ListCustomerInvoicesResult,
  CreateCustomerParams,
  UpdateCustomerParams,
  Customer,
  CustomerDetail,
  CreateProductParams,
  UpdateProductParams,
  Product,
  NetworkConfig,
  PaymentSummary,
  ListPaymentsParams,
  SubscriptionSummary,
  ListSubscriptionsParams,
  Webhook,
  CreateWebhookParams,
  UpdateWebhookParams,
} from "./types";
import { NETWORKS } from "./networks";
import { createCheckout } from "./checkout";
import { createSubscription, cancelSubscription, updateSubscriptionWallet } from "./subscription";
import { verifyPayment } from "./verify";
import { getCustomerPortal } from "./portal";
import { createPortalSession, listCustomerInvoices } from "./invoices";
import { webhooks } from "./webhooks";
import {
  createCustomer,
  getCustomer,
  updateCustomer,
  deleteCustomer,
} from "./customers";
import {
  createProduct,
  updateProduct,
  listProducts,
} from "./products";
import { listPayments, getPayment } from "./payments";
import { listSubscriptions } from "./subscriptions";
import {
  listWebhooks,
  createWebhook,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  replayWebhookDelivery,
  sendTestWebhook,
  type ReplayWebhookDeliveryResult,
  type SendTestWebhookResult,
} from "./webhook-management";
import { faucet, type FaucetParams, type FaucetResult } from "./test";
import {
  createPaymentLink,
  listPaymentLinks,
  archivePaymentLink,
  getPaymentLink,
  updatePaymentLink,
  type CreatePaymentLinkParams,
  type CreatePaymentLinkResult,
  type PaymentLink,
  type UpdatePaymentLinkParams,
} from "./payment-links";
import {
  createCoupon,
  listCoupons,
  archiveCoupon,
  applyCouponToCheckout,
  removeCouponFromCheckout,
  type Coupon,
  type CreateCouponParams,
  type ApplyCouponResult,
} from "./coupons";
import {
  listBlocklist,
  addBlocklistEntry,
  removeBlocklistEntry,
  type BlocklistEntry,
  type AddBlocklistEntryParams,
} from "./blocklist";
import {
  giftSubscription,
  scheduleSubscriptionCancellation,
  resumeSubscriptionSchedule,
  type GiftSubscriptionParams,
  type GiftedSubscription,
} from "./subscription-schedule";
import {
  refundPayment,
  type RefundPaymentParams,
  type Refund,
} from "./refunds";
import {
  extendTrial,
  compCharge,
  rescheduleSubscription,
} from "./admin";

/**
 * Paylix API client.
 *
 * **Server-side only.** Every method authenticates with an `sk_` secret
 * key, which grants full access to your organization. Instantiate it in
 * server code — an API route, a job, a server component — and read the key
 * from the environment. `pk_` publishable keys are the client-safe half of
 * the pair and are rejected by these endpoints.
 *
 * All monetary amounts on this surface are **integer cents**: `1000` is
 * $10.00.
 *
 * Every failure throws a {@link PaylixError} carrying `status`, `code`, and
 * the parsed response `body`.
 *
 * @example
 * ```ts
 * import { Paylix } from '@paylix/sdk'
 *
 * const paylix = new Paylix({
 *   apiKey: process.env.PAYLIX_SECRET_KEY!,
 *   backendUrl: 'https://pay.example.com',
 * })
 *
 * const { checkoutUrl } = await paylix.createCheckout({ productId: 'prod_abc' })
 * ```
 */
export class Paylix {
  private config: PaylixConfig;
  /** Webhook signature verification. Isomorphic; no Node builtins. */
  public webhooks = webhooks;

  constructor(config: PaylixConfig) {
    if (!config.apiKey) throw new Error("Paylix: apiKey is required");
    if (!config.backendUrl) throw new Error("Paylix: backendUrl is required");
    if (config.network !== undefined && !NETWORKS[config.network]) {
      throw new Error(`Paylix: unsupported network "${config.network}"`);
    }
    this.config = config;
  }

  /**
   * Display metadata (explorer URL, public RPC, chain ID) for the
   * configured default network, or `undefined` when `network` was omitted.
   *
   * Informational only — it does not select the chain a checkout settles
   * on. Pass `networkKey` per call for that.
   */
  get network(): NetworkConfig | undefined {
    return this.config.network ? NETWORKS[this.config.network] : undefined;
  }

  // ── Checkout & subscriptions ──────────────────────────────────────

  /**
   * Creates a hosted checkout session for a one-time product and returns
   * the URL to redirect the buyer to.
   */
  async createCheckout(params: CreateCheckoutParams): Promise<CreateCheckoutResult> {
    return createCheckout(this.config, params);
  }

  /**
   * Creates a hosted checkout session for a recurring product.
   *
   * `checkoutId` is the *session* id, not the on-chain subscription id —
   * the latter is assigned when the buyer completes the flow and arrives
   * via the `subscription.created` webhook. When the product has a trial,
   * `trialEndsAt` is populated and nothing is charged up front.
   */
  async createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
    return createSubscription(this.config, params);
  }

  /**
   * Cancels a subscription immediately via the gasless relay. Use
   * `scheduleSubscriptionCancellation` to let the customer keep access
   * until the end of the period they already paid for.
   */
  async cancelSubscription(params: CancelSubscriptionParams): Promise<void> {
    return cancelSubscription(this.config, params);
  }

  /**
   * Points a subscription at a different payer wallet. The new wallet must
   * already have signed a permit for the subscription's amount.
   */
  async updateSubscriptionWallet(params: UpdateSubscriptionWalletParams): Promise<void> {
    return updateSubscriptionWallet(this.config, params);
  }

  /**
   * Schedules cancellation at the end of the current billing period. The
   * subscription stays `active` until then.
   */
  async scheduleSubscriptionCancellation(subscriptionId: string): Promise<{ cancelAt: string }> {
    return scheduleSubscriptionCancellation(this.config, subscriptionId);
  }

  /** Undoes a pending period-end cancellation so billing continues. */
  async resumeSubscriptionSchedule(subscriptionId: string): Promise<void> {
    return resumeSubscriptionSchedule(this.config, subscriptionId);
  }

  /** Grants a subscription with no payment method and no on-chain charge. */
  async giftSubscription(params: GiftSubscriptionParams): Promise<GiftedSubscription> {
    return giftSubscription(this.config, params);
  }

  /** Lists subscriptions, newest first. Filter by customer, status, or metadata. */
  async listSubscriptions(params?: ListSubscriptionsParams): Promise<SubscriptionSummary[]> {
    return listSubscriptions(this.config, params);
  }

  // ── Payments ──────────────────────────────────────────────────────

  /**
   * Confirms a payment settled. Call this from your success handler rather
   * than trusting the redirect — `verified` is only `true` once the
   * indexer has seen the on-chain event at the configured confirmation
   * depth.
   */
  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    return verifyPayment(this.config, params);
  }

  /** Lists payments, newest first. Filter by customer, status, or metadata. */
  async listPayments(params?: ListPaymentsParams): Promise<PaymentSummary[]> {
    return listPayments(this.config, params);
  }

  /**
   * Fetches one payment.
   *
   * Returns the same verification shape as `verifyPayment` — the two are
   * aliases over one endpoint. It does **not** carry `token`,
   * `fromAddress`, `toAddress`, `createdAt`, or a `customer` object; use
   * `listPayments` when you need the full summary.
   */
  async getPayment(id: string): Promise<VerifyPaymentResult> {
    return getPayment(this.config, id);
  }

  /**
   * Records a refund you have already broadcast on-chain. Paylix is
   * non-custodial and never moves funds on your behalf.
   */
  async refundPayment(params: RefundPaymentParams): Promise<Refund> {
    return refundPayment(this.config, params);
  }

  // ── Customers ─────────────────────────────────────────────────────

  /** Creates a customer record. */
  async createCustomer(params: CreateCustomerParams): Promise<Customer> {
    return createCustomer(this.config, params);
  }

  /**
   * Fetches a customer along with their payments, subscriptions, and
   * invoices.
   */
  async getCustomer(id: string): Promise<CustomerDetail> {
    return getCustomer(this.config, id);
  }

  /** Updates a customer in place. Only the fields you pass are changed. */
  async updateCustomer(id: string, params: UpdateCustomerParams): Promise<Customer> {
    return updateCustomer(this.config, id, params);
  }

  /**
   * Soft-deletes a customer. Their payments and invoices are retained for
   * reporting.
   */
  async deleteCustomer(id: string): Promise<{ ok: true }> {
    return deleteCustomer(this.config, id);
  }

  /** Fetches the data behind the hosted customer portal for one customer. */
  async getCustomerPortal(params: CustomerPortalParams): Promise<CustomerPortalResult> {
    return getCustomerPortal(this.config, params);
  }

  /**
   * Create a signed URL to the hosted customer portal. Redirect the
   * customer to this URL so they can view their payments, subscriptions,
   * and invoices without needing a Paylix login.
   */
  async createPortalSession(params: CreatePortalSessionParams): Promise<CreatePortalSessionResult> {
    return createPortalSession(this.config, params);
  }

  /**
   * List all invoices for a customer. Each entry includes public URLs
   * for the hosted invoice page, the on-demand invoice PDF, and the
   * on-demand receipt PDF — pass these URLs directly to your customer.
   */
  async listCustomerInvoices(params: ListCustomerInvoicesParams): Promise<ListCustomerInvoicesResult> {
    return listCustomerInvoices(this.config, params);
  }

  // ── Products ──────────────────────────────────────────────────────

  /**
   * Creates a product and its per-network prices. `prices[].amount` is a
   * decimal string in the token's own units, not cents.
   */
  async createProduct(params: CreateProductParams): Promise<Product> {
    return createProduct(this.config, params);
  }

  /** Updates a product in place. Only the fields you pass are changed. */
  async updateProduct(id: string, params: UpdateProductParams): Promise<Product> {
    return updateProduct(this.config, id, params);
  }

  /** Lists every product on the organization, with its prices. */
  async listProducts(): Promise<Product[]> {
    return listProducts(this.config);
  }

  // ── Payment links ─────────────────────────────────────────────────

  /** Creates a reusable hosted payment link for a product. */
  async createPaymentLink(params: CreatePaymentLinkParams): Promise<CreatePaymentLinkResult> {
    return createPaymentLink(this.config, params);
  }

  /** Lists every payment link, archived ones included. */
  async listPaymentLinks(): Promise<PaymentLink[]> {
    return listPaymentLinks(this.config);
  }

  /** Fetches a single payment link by id. */
  async getPaymentLink(id: string): Promise<PaymentLink> {
    return getPaymentLink(this.config, id);
  }

  /** Updates a payment link in place. */
  async updatePaymentLink(id: string, params: UpdatePaymentLinkParams): Promise<PaymentLink> {
    return updatePaymentLink(this.config, id, params);
  }

  /** Deactivates a payment link. The URL stops accepting new payments. */
  async archivePaymentLink(id: string): Promise<void> {
    return archivePaymentLink(this.config, id);
  }

  // ── Coupons ───────────────────────────────────────────────────────

  /** Creates a discount code. */
  async createCoupon(params: CreateCouponParams): Promise<Coupon> {
    return createCoupon(this.config, params);
  }

  /** Lists every coupon, archived ones included. */
  async listCoupons(): Promise<Coupon[]> {
    return listCoupons(this.config);
  }

  /** Deactivates a coupon. Past redemptions keep applying. */
  async archiveCoupon(id: string): Promise<void> {
    return archiveCoupon(this.config, id);
  }

  /**
   * Applies a coupon to an open checkout session and returns the
   * recalculated totals.
   */
  async applyCouponToCheckout(sessionId: string, code: string): Promise<ApplyCouponResult> {
    return applyCouponToCheckout(this.config, sessionId, code);
  }

  /** Removes the coupon applied to a checkout session. */
  async removeCouponFromCheckout(sessionId: string): Promise<void> {
    return removeCouponFromCheckout(this.config, sessionId);
  }

  // ── Blocklist ─────────────────────────────────────────────────────

  /** Lists every blocklist entry for the current mode. */
  async listBlocklist(): Promise<BlocklistEntry[]> {
    return listBlocklist(this.config);
  }

  /** Blocks a wallet, email, or country from completing checkout. */
  async addBlocklistEntry(params: AddBlocklistEntryParams): Promise<BlocklistEntry> {
    return addBlocklistEntry(this.config, params);
  }

  /** Removes a blocklist entry, unblocking the value immediately. */
  async removeBlocklistEntry(id: string): Promise<void> {
    return removeBlocklistEntry(this.config, id);
  }

  // ── Webhooks ──────────────────────────────────────────────────────

  /** Lists every webhook endpoint on the organization. */
  async listWebhooks(): Promise<Webhook[]> {
    return listWebhooks(this.config);
  }

  /**
   * Registers a webhook endpoint. The response is the only time `secret`
   * is returned — store it, you need it to verify signatures.
   */
  async createWebhook(params: CreateWebhookParams): Promise<Webhook> {
    return createWebhook(this.config, params);
  }

  /** Fetches a webhook endpoint by id. `secret` is not included. */
  async getWebhook(id: string): Promise<Webhook> {
    return getWebhook(this.config, id);
  }

  /** Updates a webhook's URL, subscribed events, or active flag. */
  async updateWebhook(id: string, params: UpdateWebhookParams): Promise<Webhook> {
    return updateWebhook(this.config, id, params);
  }

  /** Permanently deletes a webhook endpoint. */
  async deleteWebhook(id: string): Promise<{ success: true }> {
    return deleteWebhook(this.config, id);
  }

  /** Re-sends a past delivery to its endpoint, unchanged. */
  async replayWebhookDelivery(deliveryId: string): Promise<ReplayWebhookDeliveryResult> {
    return replayWebhookDelivery(this.config, deliveryId);
  }

  /** Sends a synthetic event of the given type to a webhook endpoint. */
  async sendTestWebhook(webhookId: string, event: string): Promise<SendTestWebhookResult> {
    return sendTestWebhook(this.config, webhookId, event);
  }

  // ── Subscription admin ────────────────────────────────────────────

  /** Pushes a trial's end date out by `days`. Only valid while `trialing`. */
  async extendTrial(subscriptionId: string, days: number): Promise<{ success: true; trialEndsAt: string }> {
    return extendTrial(this.config, subscriptionId, days);
  }

  /**
   * Records a zero-amount charge for the current period and advances the
   * next charge date. Nothing moves on-chain.
   */
  async compCharge(subscriptionId: string): Promise<{ success: true; paymentId: string; nextChargeDate: string }> {
    return compCharge(this.config, subscriptionId);
  }

  /** Moves the next charge to a specific ISO-8601 instant. */
  async rescheduleSubscription(subscriptionId: string, nextChargeDate: string): Promise<{ success: true; nextChargeDate: string }> {
    return rescheduleSubscription(this.config, subscriptionId, nextChargeDate);
  }

  // ── Test helpers ──────────────────────────────────────────────────

  /** Mints mock USDC on a testnet deployment. Rejected outside test mode. */
  async testFaucet(req: FaucetParams): Promise<FaucetResult> {
    return faucet(this.config, req);
  }
}
