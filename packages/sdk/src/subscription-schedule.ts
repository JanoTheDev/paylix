import { request } from "./request";
import type { PaylixConfig, SubscriptionStatus } from "./types";

export interface GiftSubscriptionParams {
  productId: string;
  /** Paylix customer id (UUID) to receive the gift. */
  customerId: string;
  /**
   * ISO-8601 timestamp at which the gift lapses to `expired`. Omit for a
   * gift that never expires.
   */
  expiresAt?: string;
  metadata?: Record<string, string>;
}

export interface GiftedSubscription {
  id: string;
  productId: string;
  customerId: string;
  status: SubscriptionStatus;
  isGift: boolean;
  giftExpiresAt: string | null;
  createdAt: string;
}

/**
 * Grants a subscription with no payment method and no on-chain
 * transaction. The keeper never charges a gift; it flips to `expired` when
 * `expiresAt` passes.
 */
export async function giftSubscription(
  config: PaylixConfig,
  params: GiftSubscriptionParams,
): Promise<GiftedSubscription> {
  return request<GiftedSubscription>(config, "POST", "/api/subscriptions/gift", {
    body: params,
  });
}

export type CancelWhen = "immediate" | "period_end";

/**
 * Schedule a cancellation at the end of the current billing period.
 * Subscription stays `active` until next_charge_date; keeper flips it
 * to `cancelled` then. Use `resumeSubscriptionSchedule` to undo before
 * the boundary passes.
 *
 * For an immediate, gasless cancellation instead, use
 * `cancelSubscription`.
 */
export async function scheduleSubscriptionCancellation(
  config: PaylixConfig,
  subscriptionId: string,
): Promise<{ cancelAt: string }> {
  return request<{ cancelAt: string }>(
    config,
    "POST",
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    { body: { when: "period_end" satisfies CancelWhen } },
  );
}

/**
 * Cancels a pending period-end cancellation, so the subscription keeps
 * renewing. No-op if no cancellation is scheduled.
 */
export async function resumeSubscriptionSchedule(
  config: PaylixConfig,
  subscriptionId: string,
): Promise<void> {
  await request<void>(
    config,
    "POST",
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}/resume-schedule`,
  );
}
