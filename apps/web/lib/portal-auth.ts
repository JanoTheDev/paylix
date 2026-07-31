import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { db } from "./db";
import { apiError } from "./api-error";
import { verifyPortalToken } from "./portal-tokens";
import { checkRateLimitAsync } from "./rate-limit";
import { getClientIp } from "./client-ip";

/**
 * Single implementation of "authenticate a customer-portal request".
 *
 * The 11 portal routes each hand-rolled `verifyPortalToken` + an ownership
 * comparison, and had already drifted: some read the token from the body,
 * some from the query string; some answered `invalid_token`, some
 * `unauthorized`; one compared ownership with a redundant double-`eq`.
 * Route everything through here so the error shape and the checks stay
 * identical.
 */

export type PortalAuth =
  | { ok: true; customerId: string }
  | { ok: false; response: NextResponse };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unauthorized(): { ok: false; response: NextResponse } {
  // One generic message for every failure mode (missing, malformed, expired,
  // wrong customer) so the endpoint can't be used to probe customer ids.
  return {
    ok: false,
    response: apiError("invalid_token", "Invalid or expired portal token", 401),
  };
}

const PORTAL_LIMIT_PER_MINUTE = 60;

/**
 * Per-IP throttle. Portal tokens are HMACs, but the endpoints behind them
 * expose full billing history, so brute-force attempts shouldn't be free.
 * Every entry point goes through this — an unthrottled sibling is the same
 * hole with a different name.
 */
async function portalRateLimit(
  request: Request,
): Promise<NextResponse | null> {
  const ip = getClientIp(request);
  const rl = await checkRateLimitAsync(
    `portal:${ip}`,
    PORTAL_LIMIT_PER_MINUTE,
    60_000,
  );
  if (rl.ok) return null;
  const retryAfter = String(Math.ceil((rl.retryAfterMs ?? 0) / 1000));
  return NextResponse.json(
    {
      error: {
        code: "rate_limited",
        message: `Too many portal requests. Retry in ${retryAfter}s`,
      },
    },
    { status: 429, headers: { "Retry-After": retryAfter } },
  );
}

/**
 * Verify a portal token against a customer id, taking both from the request
 * (query string first, then an already-parsed body object).
 */
export async function requirePortalCustomer(
  request: Request,
  body?: Record<string, unknown> | null,
): Promise<PortalAuth> {
  const url = new URL(request.url);
  const token =
    url.searchParams.get("token") ??
    (typeof body?.token === "string" ? body.token : null);
  const customerId =
    url.searchParams.get("customerId") ??
    (typeof body?.customerId === "string" ? body.customerId : null);

  const limited = await portalRateLimit(request);
  if (limited) return { ok: false, response: limited };

  if (!token || !customerId || !UUID_RE.test(customerId)) return unauthorized();
  if (!verifyPortalToken(token, customerId)) return unauthorized();

  return { ok: true, customerId };
}

/**
 * Same as above but for routes whose customer id comes from the path segment
 * (`/api/portal/[customerId]` — the billing-history endpoint). Rate-limited
 * identically.
 */
export async function requirePortalCustomerId(
  request: Request,
  customerId: string,
  body?: Record<string, unknown> | null,
): Promise<PortalAuth> {
  const url = new URL(request.url);
  const token =
    url.searchParams.get("token") ??
    (typeof body?.token === "string" ? body.token : null);

  const limited = await portalRateLimit(request);
  if (limited) return { ok: false, response: limited };

  if (!token || !customerId || !UUID_RE.test(customerId)) return unauthorized();
  if (!verifyPortalToken(token, customerId)) return unauthorized();
  return { ok: true, customerId };
}

export type OwnedSubscription =
  | { ok: true; subscription: typeof subscriptions.$inferSelect }
  | { ok: false; response: NextResponse };

/**
 * Load a subscription and prove it belongs to the authenticated customer.
 * The ownership predicate is part of the WHERE clause, so a mismatch can
 * never be missed by a forgotten JS comparison.
 */
export async function requireOwnedSubscription(
  customerId: string,
  subscriptionId: string,
): Promise<OwnedSubscription> {
  if (!subscriptionId || !UUID_RE.test(subscriptionId)) {
    return {
      ok: false,
      response: apiError("not_found", "Subscription not found", 404),
    };
  }

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, subscriptionId),
        eq(subscriptions.customerId, customerId),
      ),
    )
    .limit(1);

  if (!sub) {
    // 404 rather than 403: "exists but isn't yours" is itself information.
    return {
      ok: false,
      response: apiError("not_found", "Subscription not found", 404),
    };
  }

  return { ok: true, subscription: sub };
}
