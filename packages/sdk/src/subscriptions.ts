import { buildQuery, request } from "./request";
import type {
  PaylixConfig,
  SubscriptionSummary,
  ListSubscriptionsParams,
} from "./types";

export async function listSubscriptions(
  config: PaylixConfig,
  params?: ListSubscriptionsParams,
): Promise<SubscriptionSummary[]> {
  return request<SubscriptionSummary[]>(config, "GET", "/api/subscriptions", {
    query: buildQuery(params),
  });
}
