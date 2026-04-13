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
import { faucet } from "./test";

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

  async testFaucet(req: { address: string; amount?: number }): Promise<{ success: true; txHash: string; amountMinted: number }> {
    return faucet(this.config, req);
  }
}
