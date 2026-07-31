import { request } from "./request";
import type { PaylixConfig } from "./types";

/**
 * These three routes are **accumulative and not idempotent server-side**.
 *
 * `extend-trial`, `comp-charge`, and `reschedule` do not wrap themselves in
 * the API's `withIdempotency` helper, so they ignore the `Idempotency-Key`
 * header the SDK sends on other POSTs. Applying one twice applies its
 * effect twice: `extendTrial(id, 7)` becomes 14 free days, and
 * `compCharge(id)` inserts a second zero-amount payment row *and* advances
 * `next_charge_date` by a second interval — two free billing periods and a
 * ledger that no longer reconciles.
 *
 * That failure needs no network fault to trigger: a request that succeeded
 * server-side but whose response was lost to a 504 or the client timeout
 * looks identical to one that never arrived.
 *
 * So these calls opt out of retries entirely (`retry: false`) and suppress
 * the idempotency header (`idempotencyKey: null`) rather than advertise a
 * guarantee the server does not honour. A lost response surfaces to the
 * caller as a `PaylixError`; re-issue only after reading the subscription
 * back.
 *
 * Once the routes adopt `withIdempotency` (filed as R7 in
 * `audit/_requests-sdk.md`), drop both flags and they inherit the normal
 * retry behaviour.
 */
const NO_REPLAY = { retry: false, idempotencyKey: null } as const;

/**
 * Pushes a trial's end date further out. Only valid while the
 * subscription is `trialing`; the trial converter picks up the new date on
 * its next tick.
 *
 * **Never retried automatically** — the effect accumulates, so a replay
 * would grant the days twice. On a `connection` or `timeout` error, read
 * the subscription back before re-issuing.
 *
 * @param days Whole days to add to the current `trialEndsAt`.
 */
export async function extendTrial(
  config: PaylixConfig,
  subscriptionId: string,
  days: number,
): Promise<{ success: true; trialEndsAt: string }> {
  return request<{ success: true; trialEndsAt: string }>(
    config,
    "POST",
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}/extend-trial`,
    { body: { days }, ...NO_REPLAY },
  );
}

/**
 * Records a zero-amount ("complimentary") charge for the current billing
 * period and advances `nextChargeDate` by one interval. Nothing moves
 * on-chain — use this to comp a customer without cancelling their
 * subscription.
 *
 * **Never retried automatically** — the effect accumulates, so a replay
 * would comp two periods and write a duplicate payment row. On a
 * `connection` or `timeout` error, read the subscription back before
 * re-issuing.
 */
export async function compCharge(
  config: PaylixConfig,
  subscriptionId: string,
): Promise<{ success: true; paymentId: string; nextChargeDate: string }> {
  return request<{ success: true; paymentId: string; nextChargeDate: string }>(
    config,
    "POST",
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}/comp-charge`,
    NO_REPLAY,
  );
}

/**
 * Moves the next charge to a specific instant, shifting the whole billing
 * anchor. Useful for aligning a customer to a calendar boundary.
 *
 * **Never retried automatically.** This one sets an absolute date rather
 * than accumulating, but it shares the other two routes' lack of
 * server-side idempotency and is held to the same rule.
 *
 * @param nextChargeDate ISO-8601 timestamp. Must be in the future.
 */
export async function rescheduleSubscription(
  config: PaylixConfig,
  subscriptionId: string,
  nextChargeDate: string,
): Promise<{ success: true; nextChargeDate: string }> {
  return request<{ success: true; nextChargeDate: string }>(
    config,
    "POST",
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}/reschedule`,
    { body: { nextChargeDate }, ...NO_REPLAY },
  );
}
