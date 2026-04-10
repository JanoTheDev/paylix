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
} from "./types";
import { NETWORKS } from "./networks";
import { createCheckout } from "./checkout";
import { createSubscription, cancelSubscription, updateSubscriptionWallet } from "./subscription";
import { verifyPayment } from "./verify";
import { getCustomerPortal } from "./portal";
import { webhooks } from "./webhooks";

export class Paylix {
  private config: PaylixConfig;
  public webhooks = webhooks;

  constructor(config: PaylixConfig) {
    if (!config.apiKey) throw new Error("Paylix: apiKey is required");
    if (!config.backendUrl) throw new Error("Paylix: backendUrl is required");
    if (!config.merchantWallet) throw new Error("Paylix: merchantWallet is required");
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
}
