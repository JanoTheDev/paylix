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
  listCustomers,
  deleteCustomer,
} from "./customers";
import {
  createProduct,
  getProduct,
  updateProduct,
  listProducts,
} from "./products";
import { listPayments, getPayment } from "./payments";
import { listSubscriptions, getSubscription } from "./subscriptions";
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
import { faucet } from "./test";
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

export class Paylix {
  private config: PaylixConfig;
  public webhooks = webhooks;

  constructor(config: PaylixConfig) {
    if (!config.apiKey) throw new Error("Paylix: apiKey is required");
    if (!config.backendUrl) throw new Error("Paylix: backendUrl is required");
    if (!NETWORKS[config.network]) {
      throw new Error(`Paylix: unsupported network "${config.network}"`);
    }
    this.config = config;
  }

  get network() {
    return NETWORKS[this.config.network];
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CreateCheckoutResult> {
    return createCheckout(this.config, params);
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
    return createSubscription(this.config, params);
  }

  async cancelSubscription(params: CancelSubscriptionParams): Promise<void> {
    return cancelSubscription(this.config, params);
  }

  async updateSubscriptionWallet(params: UpdateSubscriptionWalletParams): Promise<void> {
    return updateSubscriptionWallet(this.config, params);
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    return verifyPayment(this.config, params);
  }

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

  async createCustomer(params: CreateCustomerParams): Promise<Customer> {
    return createCustomer(this.config, params);
  }

  async getCustomer(id: string): Promise<CustomerDetail> {
    return getCustomer(this.config, id);
  }

  async updateCustomer(id: string, params: UpdateCustomerParams): Promise<Customer> {
    return updateCustomer(this.config, id, params);
  }

  async listCustomers(): Promise<Customer[]> {
    return listCustomers(this.config);
  }

  async deleteCustomer(id: string): Promise<{ ok: true }> {
    return deleteCustomer(this.config, id);
  }

  async createProduct(params: CreateProductParams): Promise<Product> {
    return createProduct(this.config, params);
  }

  async getProduct(id: string): Promise<Product> {
    return getProduct(this.config, id);
  }

  async updateProduct(id: string, params: UpdateProductParams): Promise<Product> {
    return updateProduct(this.config, id, params);
  }

  async listProducts(): Promise<Product[]> {
    return listProducts(this.config);
  }

  async listPayments(params?: ListPaymentsParams): Promise<PaymentSummary[]> {
    return listPayments(this.config, params);
  }

  async getPayment(id: string): Promise<PaymentSummary> {
    return getPayment(this.config, id);
  }

  async listSubscriptions(params?: ListSubscriptionsParams): Promise<SubscriptionSummary[]> {
    return listSubscriptions(this.config, params);
  }

  async getSubscription(id: string): Promise<SubscriptionSummary> {
    return getSubscription(this.config, id);
  }

  async listWebhooks(): Promise<Webhook[]> {
    return listWebhooks(this.config);
  }

  async createWebhook(params: CreateWebhookParams): Promise<Webhook> {
    return createWebhook(this.config, params);
  }

  async getWebhook(id: string): Promise<Webhook> {
    return getWebhook(this.config, id);
  }

  async updateWebhook(id: string, params: UpdateWebhookParams): Promise<Webhook> {
    return updateWebhook(this.config, id, params);
  }

  async deleteWebhook(id: string): Promise<{ success: true }> {
    return deleteWebhook(this.config, id);
  }

  async testFaucet(req: { address: string; amount?: number }): Promise<{ success: true; txHash: string; amountMinted: number }> {
    return faucet(this.config, req);
  }

  async createPaymentLink(params: CreatePaymentLinkParams): Promise<CreatePaymentLinkResult> {
    return createPaymentLink(this.config, params);
  }

  async listPaymentLinks(): Promise<PaymentLink[]> {
    return listPaymentLinks(this.config);
  }

  async getPaymentLink(id: string): Promise<PaymentLink> {
    return getPaymentLink(this.config, id);
  }

  async updatePaymentLink(id: string, params: UpdatePaymentLinkParams): Promise<PaymentLink> {
    return updatePaymentLink(this.config, id, params);
  }

  async archivePaymentLink(id: string): Promise<void> {
    return archivePaymentLink(this.config, id);
  }

  async createCoupon(params: CreateCouponParams): Promise<Coupon> {
    return createCoupon(this.config, params);
  }

  async listCoupons(): Promise<Coupon[]> {
    return listCoupons(this.config);
  }

  async archiveCoupon(id: string): Promise<void> {
    return archiveCoupon(this.config, id);
  }

  async applyCouponToCheckout(sessionId: string, code: string): Promise<ApplyCouponResult> {
    return applyCouponToCheckout(this.config, sessionId, code);
  }

  async removeCouponFromCheckout(sessionId: string): Promise<void> {
    return removeCouponFromCheckout(this.config, sessionId);
  }

  async listBlocklist(): Promise<BlocklistEntry[]> {
    return listBlocklist(this.config);
  }

  async addBlocklistEntry(params: AddBlocklistEntryParams): Promise<BlocklistEntry> {
    return addBlocklistEntry(this.config, params);
  }

  async removeBlocklistEntry(id: string): Promise<void> {
    return removeBlocklistEntry(this.config, id);
  }

  async giftSubscription(params: GiftSubscriptionParams): Promise<GiftedSubscription> {
    return giftSubscription(this.config, params);
  }

  async scheduleSubscriptionCancellation(subscriptionId: string): Promise<{ cancelAt: string }> {
    return scheduleSubscriptionCancellation(this.config, subscriptionId);
  }

  async resumeSubscriptionSchedule(subscriptionId: string): Promise<void> {
    return resumeSubscriptionSchedule(this.config, subscriptionId);
  }

  async refundPayment(params: RefundPaymentParams): Promise<Refund> {
    return refundPayment(this.config, params);
  }

  async extendTrial(subscriptionId: string, days: number) {
    return extendTrial(this.config, subscriptionId, days);
  }

  async compCharge(subscriptionId: string) {
    return compCharge(this.config, subscriptionId);
  }

  async rescheduleSubscription(subscriptionId: string, nextChargeDate: string) {
    return rescheduleSubscription(this.config, subscriptionId, nextChargeDate);
  }

  async replayWebhookDelivery(deliveryId: string): Promise<ReplayWebhookDeliveryResult> {
    return replayWebhookDelivery(this.config, deliveryId);
  }

  async sendTestWebhook(webhookId: string, event: string): Promise<SendTestWebhookResult> {
    return sendTestWebhook(this.config, webhookId, event);
  }
}
