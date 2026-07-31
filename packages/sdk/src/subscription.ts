import { buildCheckoutBody } from "./checkout";
import { request } from "./request";
import type {
  PaylixConfig,
  CreateSubscriptionParams,
  CreateSubscriptionResult,
  CancelSubscriptionParams,
  UpdateSubscriptionWalletParams,
} from "./types";

export async function createSubscription(
  config: PaylixConfig,
  params: CreateSubscriptionParams,
): Promise<CreateSubscriptionResult> {
  const data = await request<{
    checkoutUrl: string;
    checkoutId: string;
    trialEndsAt?: string;
  }>(config, "POST", "/api/checkout", {
    body: buildCheckoutBody(params, "subscription"),
  });

  return {
    checkoutUrl: data.checkoutUrl,
    checkoutId: data.checkoutId,
    trialEndsAt: typeof data.trialEndsAt === "string" ? data.trialEndsAt : null,
  };
}

export async function cancelSubscription(
  config: PaylixConfig,
  params: CancelSubscriptionParams,
): Promise<void> {
  await request<void>(
    config,
    "POST",
    `/api/subscriptions/${encodeURIComponent(params.subscriptionId)}/cancel-gasless`,
  );
}

export async function updateSubscriptionWallet(
  config: PaylixConfig,
  params: UpdateSubscriptionWalletParams,
): Promise<void> {
  await request<void>(
    config,
    "POST",
    `/api/subscriptions/${encodeURIComponent(params.subscriptionId)}/update-wallet`,
    { body: { newWallet: params.newWallet } },
  );
}
