/**
 * Portal request bodies all carry `{ subscriptionId, customerId, token }`.
 * `customerId`/`token` are handled by `lib/portal-auth`; this just pulls the
 * subscription id out without another `as { subscriptionId?: string }` cast
 * in every route. A missing or non-string value becomes `""`, which
 * `requireOwnedSubscription` rejects as a 404.
 */
export function readPortalSubscriptionId(
  body: Record<string, unknown> | null | undefined,
): string {
  const value = body?.subscriptionId;
  return typeof value === "string" ? value : "";
}
