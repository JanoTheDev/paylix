import { db } from "@/lib/db";
import { checkoutSessions, customers, products, payments } from "@paylix/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { signPortalToken } from "@/lib/portal-tokens";
import { normalizeEmail } from "@/lib/email-normalize";
import { apiError } from "@/lib/api-error";
import { resolveTax } from "@/lib/tax-rates";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import { clientIpKey } from "../../_shared/client-ip";
import { readJsonBody, parseWith } from "../../_shared/http";
import {
  checkoutCookieOptions,
  readCheckoutToken,
  signCheckoutToken,
  verifyCheckoutToken,
} from "../../_shared/checkout-token";
import {
  baseUnitsPerCentFor,
  nativeUnitsToCentsSaturating,
} from "../../_shared/token-scale";

/**
 * Buyer-facing writes on a checkout session.
 *
 * This handler is reachable without credentials — the checkout page is
 * public and the session id in the URL is the only thing the buyer's browser
 * holds. That makes three properties non-negotiable, and none of them held
 * before:
 *
 *  1. **The price is immutable.** `subtotalAmount` is snapshotted once, from
 *     the merchant-set product price, and is never rewritten here. `amount`
 *     is only ever *derived* — `subtotal - discount + tax` — where `tax`
 *     comes from the server's own rate table keyed on the buyer's declared
 *     country. No request field reaches `amount`, `subtotalAmount` or
 *     `discountCents` directly. Previously a caller could set a zero-VAT
 *     country on *any* org's session and strip the tax out of `amount`
 *     before the buyer signed.
 *  2. **Only open sessions are mutable.** Anything past the point of no
 *     return — completed, expired, abandoned, or with a relay in flight —
 *     is frozen. The old handler happily rewrote the recorded amount of a
 *     `completed` session.
 *  3. **Every field is bounded.** The body was typed with all-`unknown`
 *     fields and validated only by a trim; arbitrary-length strings landed
 *     in the columns the trial anti-abuse dedup keys on.
 *
 * Rate limits are per-IP and per-session so the endpoint can't be used to
 * grind through session ids or rewrite one session in a loop.
 */

/**
 * Statuses in which buyer-supplied details may still be collected.
 *
 * `abandoned` MUST stay in this set. The checkout client sendBeacons
 * `{status:"abandoned"}` on tab close and PATCHes `{status:"viewed"}` on
 * mount, so a buyer who closes the tab and comes back through the same link
 * has to be able to reclaim the session — otherwise the reopen 409s here and
 * `relay/validation.ts` then refuses to pay an `abandoned` session, leaving
 * the checkout link permanently dead. Abandonment is a soft, reversible
 * signal for recovery emails; the relay independently refuses to settle an
 * abandoned session, so allowing the transition back costs nothing.
 */
const MUTABLE_STATUSES = new Set([
  "active",
  "awaiting_currency",
  "viewed",
  "abandoned",
]);

const customerFormSchema = z.object({
  firstName: z.string().trim().max(100).nullish(),
  lastName: z.string().trim().max(100).nullish(),
  email: z.string().trim().max(254).email("email is not a valid address").nullish(),
  phone: z.string().trim().max(32).nullish(),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "country must be a 2-letter ISO code")
    .nullish(),
  taxId: z.string().trim().max(64).nullish(),
});

const patchSchema = z.object({
  // "completed" is intentionally NOT accepted. Only the indexer may mark a
  // session completed, since that reflects on-chain financial state.
  status: z.enum(["viewed", "abandoned"]).optional(),
  customer: customerFormSchema.optional(),
});

type CustomerForm = z.infer<typeof customerFormSchema>;

function blank(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCustomerForm(raw: CustomerForm) {
  const cleanedEmail = blank(raw.email);
  return {
    firstName: blank(raw.firstName),
    lastName: blank(raw.lastName),
    email: cleanedEmail ? normalizeEmail(cleanedEmail) : null,
    phone: blank(raw.phone),
    country: blank(raw.country)?.toUpperCase() ?? null,
    taxId: blank(raw.taxId),
  };
}

function hasAnyValue(values: Record<string, string | null>) {
  return Object.values(values).some((v) => v !== null);
}

function safeSignPortalToken(customerUuid: string): string | null {
  try {
    return signPortalToken(customerUuid);
  } catch (err) {
    console.error("[checkout] portal token unavailable:", err);
    return null;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [session] = await db
    .select({
      id: checkoutSessions.id,
      status: checkoutSessions.status,
      amount: checkoutSessions.amount,
      subtotalAmount: checkoutSessions.subtotalAmount,
      taxAmount: checkoutSessions.taxAmount,
      taxRateBps: checkoutSessions.taxRateBps,
      taxLabel: checkoutSessions.taxLabel,
      networkKey: checkoutSessions.networkKey,
      tokenSymbol: checkoutSessions.tokenSymbol,
      type: checkoutSessions.type,
      merchantWallet: checkoutSessions.merchantWallet,
      customerId: checkoutSessions.customerId,
      successUrl: checkoutSessions.successUrl,
      cancelUrl: checkoutSessions.cancelUrl,
      metadata: checkoutSessions.metadata,
      expiresAt: checkoutSessions.expiresAt,
      productId: checkoutSessions.productId,
      paymentId: checkoutSessions.paymentId,
      productName: products.name,
      productDescription: products.description,
      checkoutFields: products.checkoutFields,
      billingInterval: products.billingInterval,
      customerUuid: payments.customerId,
      livemode: checkoutSessions.livemode,
      // Fee ceiling captured at quote time, in basis points. The buyer binds
      // this into the EIP-712 intent, so the page prop and this response must
      // carry the same value — the client fails closed when it is null.
      maxFeeBps: checkoutSessions.maxFeeBps,
    })
    .from(checkoutSessions)
    .innerJoin(products, eq(checkoutSessions.productId, products.id))
    .leftJoin(payments, eq(checkoutSessions.paymentId, payments.id))
    .where(eq(checkoutSessions.id, id));

  if (!session) return apiError("not_found", "Not found", 404);

  // Check if expired
  // session.amount is a bigint (native token units) — JSON.stringify can't
  // handle BigInt, so serialize it to a string before returning.
  const serialized = {
    ...session,
    amount: session.amount?.toString() ?? null,
    subtotalAmount: session.subtotalAmount?.toString() ?? null,
    taxAmount: session.taxAmount?.toString() ?? null,
  };

  if (session.status === "active" && new Date(session.expiresAt) < new Date()) {
    await db
      .update(checkoutSessions)
      .set({ status: "expired" })
      .where(eq(checkoutSessions.id, id));
    return withCheckoutCookie(
      NextResponse.json({ ...serialized, status: "expired" }),
      id,
    );
  }

  // signPortalToken throws on a missing/short BETTER_AUTH_SECRET. That's a
  // deployment problem, not a reason to 500 the public checkout page — the
  // portal link is optional here.
  const portalToken = session.customerUuid
    ? safeSignPortalToken(session.customerUuid)
    : null;

  return withCheckoutCookie(
    NextResponse.json({ ...serialized, portalToken }),
    id,
  );
}

/**
 * Attach the per-session checkout cookie. Every load of the checkout page
 * GETs this endpoint, so the buyer's browser always ends up holding one
 * before it submits the customer form.
 */
function withCheckoutCookie(
  response: NextResponse,
  sessionId: string,
): NextResponse {
  try {
    response.cookies.set({
      ...checkoutCookieOptions(sessionId),
      value: signCheckoutToken(sessionId),
    });
  } catch (err) {
    // Missing/short signing secret. Reads stay available; writes that need
    // the cookie will fail closed in PATCH.
    console.error("[checkout] session token unavailable:", err);
  }
  return response;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Two buckets: one stops a caller grinding through session ids, the other
  // stops a single session being rewritten in a loop.
  const ip = clientIpKey(request);
  const ipLimit = await checkRateLimitAsync(`checkout-patch:${ip}`, 60, 60_000);
  if (!ipLimit.ok) {
    return rateLimited(ipLimit.retryAfterMs);
  }
  const sessionLimit = await checkRateLimitAsync(
    `checkout-patch-session:${id}`,
    20,
    60_000,
  );
  if (!sessionLimit.ok) {
    return rateLimited(sessionLimit.retryAfterMs);
  }

  const rawBody = await readJsonBody(request);
  if (!rawBody.ok) return rawBody.response;
  const parsed = parseWith(patchSchema, rawBody.data);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.status === undefined && body.customer === undefined) {
    return apiError("invalid_request", "No valid fields to update");
  }

  // Buyer details — the PII the trial dedup keys on, and the `country` that
  // drives the tax recompute and therefore the charged total — require the
  // per-session cookie minted by GET. Bare lifecycle transitions
  // (`viewed`/`abandoned`) deliberately do not: the abandonment signal is
  // sent via `navigator.sendBeacon` on tab close, and it writes nothing an
  // attacker gains from.
  if (body.customer !== undefined) {
    const token = readCheckoutToken(request);
    if (!verifyCheckoutToken(token, id)) {
      return apiError(
        "checkout_token_required",
        "Load the checkout page before submitting customer details.",
        401,
      );
    }
  }

  const [session] = await db
    .select({
      id: checkoutSessions.id,
      organizationId: checkoutSessions.organizationId,
      livemode: checkoutSessions.livemode,
      customerId: checkoutSessions.customerId,
      status: checkoutSessions.status,
      expiresAt: checkoutSessions.expiresAt,
      relayInFlightAt: checkoutSessions.relayInFlightAt,
      productId: checkoutSessions.productId,
      networkKey: checkoutSessions.networkKey,
      tokenSymbol: checkoutSessions.tokenSymbol,
      amount: checkoutSessions.amount,
      subtotalAmount: checkoutSessions.subtotalAmount,
      taxAmount: checkoutSessions.taxAmount,
    })
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, id));

  if (!session) return apiError("not_found", "Not found", 404);

  // State guard. Everything past this point writes to a session the buyer
  // may still be filling in; a completed/expired/abandoned session, or one
  // whose relay is mid-flight, is frozen.
  if (!MUTABLE_STATUSES.has(session.status)) {
    return apiError(
      "invalid_state",
      `Checkout session is '${session.status}' and can no longer be modified`,
      409,
    );
  }
  if (session.relayInFlightAt !== null) {
    return apiError(
      "relay_in_flight",
      "A payment is being submitted for this session",
      409,
    );
  }
  if (new Date(session.expiresAt) < new Date()) {
    return apiError("session_expired", "Checkout session has expired", 410);
  }

  const sessionPatch: Record<string, string | number | bigint | Date | null> = {};

  if (body.status === "viewed") {
    sessionPatch.status = "viewed";
    sessionPatch.viewedAt = new Date();
  } else if (body.status === "abandoned") {
    sessionPatch.status = "abandoned";
  }

  // Persist collected customer form fields (names, email, phone, country,
  // taxId) onto the customers row. We can only do this pre-payment when the
  // merchant has attached a stable customerId to the session — otherwise
  // the customer row is created by the indexer after PaymentReceived, and
  // we have no key to upsert against yet.
  //
  // Regardless of named/anonymous, we also stash country + taxId on the
  // checkout_sessions row itself so the indexer can propagate them into the
  // customer row when it creates the anon_<wallet> customer post-payment.
  let normalized: ReturnType<typeof normalizeCustomerForm> | null = null;
  if (body.customer) {
    normalized = normalizeCustomerForm(body.customer);
    if (!hasAnyValue(normalized)) {
      normalized = null;
    }
  }

  if (normalized) {
    if (normalized.country !== null) sessionPatch.buyerCountry = normalized.country;
    if (normalized.taxId !== null) sessionPatch.buyerTaxId = normalized.taxId;
    if (normalized.firstName !== null) sessionPatch.buyerFirstName = normalized.firstName;
    if (normalized.lastName !== null) sessionPatch.buyerLastName = normalized.lastName;
    if (normalized.email !== null) sessionPatch.buyerEmail = normalized.email;
    if (normalized.phone !== null) sessionPatch.buyerPhone = normalized.phone;

    if (normalized.country !== null) {
      const taxPatch = await computeTaxPatch(session, {
        country: normalized.country,
        taxId: normalized.taxId,
      });
      Object.assign(sessionPatch, taxPatch);
    }
  }

  if (Object.keys(sessionPatch).length > 0) {
    // The `relay_in_flight_at IS NULL` predicate makes the write lose to a
    // relay that started between the guard above and here, rather than
    // mutating a session whose amount is already being signed for.
    await db
      .update(checkoutSessions)
      .set(sessionPatch)
      .where(
        and(
          eq(checkoutSessions.id, id),
          isNull(checkoutSessions.relayInFlightAt),
        ),
      );
  }

  if (normalized && session.customerId) {
    const setValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(normalized)) {
      if (v !== null) setValues[k] = v;
    }
    await db
      .insert(customers)
      .values({
        organizationId: session.organizationId,
        livemode: session.livemode,
        customerId: session.customerId,
        ...setValues,
      })
      .onConflictDoUpdate({
        target: [customers.organizationId, customers.customerId],
        set: setValues,
      });
  }

  // Read back the derived figures rather than echoing the request: the
  // checkout client signs the permit against `amount`, so it has to be the
  // stored value, and no buyer PII is reflected back to an anonymous caller.
  const [updated] = await db
    .select({
      id: checkoutSessions.id,
      status: checkoutSessions.status,
      amount: checkoutSessions.amount,
      subtotalAmount: checkoutSessions.subtotalAmount,
      taxAmount: checkoutSessions.taxAmount,
      taxRateBps: checkoutSessions.taxRateBps,
      taxLabel: checkoutSessions.taxLabel,
    })
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, id));

  if (!updated) return apiError("not_found", "Not found", 404);

  return NextResponse.json({
    ok: true,
    ...updated,
    amount: updated.amount?.toString() ?? null,
    subtotalAmount: updated.subtotalAmount?.toString() ?? null,
    taxAmount: updated.taxAmount?.toString() ?? null,
  });
}

function rateLimited(retryAfterMs: number | undefined): NextResponse {
  const retryAfter = String(Math.ceil((retryAfterMs ?? 0) / 1000));
  return NextResponse.json(
    {
      error: {
        code: "rate_limited",
        message: `Too many requests. Retry in ${retryAfter}s`,
      },
    },
    { status: 429, headers: { "Retry-After": retryAfter } },
  );
}

/**
 * Recomputes the tax breakdown for a country change.
 *
 * Everything here is derived from stored state plus the server's own rate
 * table. The caller supplies a country code and nothing else; it can never
 * set an amount, a rate or a discount.
 *
 *   subtotalAmount — the immutable pre-discount, pre-tax base. Snapshotted
 *                    the first time tax or a coupon touches the session and
 *                    never rewritten afterwards.
 *   discount       — recovered exactly as `subtotal - (amount - oldTax)`,
 *                    which works in native units regardless of whether the
 *                    coupon was percent- or cents-denominated.
 *   tax            — a percentage of the *discounted* base, per the usual
 *                    VAT ordering.
 */
async function computeTaxPatch(
  session: {
    productId: string;
    networkKey: string | null;
    tokenSymbol: string | null;
    amount: bigint;
    subtotalAmount: bigint | null;
    taxAmount: bigint | null;
  },
  normalized: { country: string; taxId: string | null },
): Promise<Record<string, string | number | bigint | null>> {
  const subtotal = session.subtotalAmount ?? session.amount;
  if (subtotal <= 0n) return {};

  // Multi-token: the cents scale depends on the locked token's decimals.
  // A hardcoded 10_000 (USDC's 6) was off by 10^12 for an 18-decimal token,
  // which then overflowed resolveTax's int32 truncation and silently
  // returned "no tax".
  const unitsPerCent = baseUnitsPerCentFor(session.networkKey, session.tokenSymbol);
  if (unitsPerCent === null) {
    // Currency not locked yet (or not registered) — there's no meaningful
    // scale, so leave the breakdown untouched.
    return {};
  }

  const oldTax = session.taxAmount ?? 0n;
  let discount = subtotal - (session.amount - oldTax);
  if (discount < 0n) discount = 0n;
  if (discount > subtotal) discount = subtotal;
  const taxable = subtotal - discount;

  const [prod] = await db
    .select({
      taxRateBps: products.taxRateBps,
      taxLabel: products.taxLabel,
      reverseChargeEligible: products.reverseChargeEligible,
    })
    .from(products)
    .where(eq(products.id, session.productId));

  const isReverse =
    (prod?.reverseChargeEligible ?? false) && normalized.taxId !== null;

  const resolution = resolveTax({
    country: normalized.country,
    subtotalCents: nativeUnitsToCentsSaturating(taxable, unitsPerCent),
    productRateBps: prod?.taxRateBps ?? null,
    productLabel: prod?.taxLabel ?? null,
    reverseCharge: isReverse,
  });

  if (resolution && resolution.rateBps > 0) {
    const taxAmount = (taxable * BigInt(resolution.rateBps)) / 10000n;
    return {
      subtotalAmount: subtotal,
      taxAmount,
      taxRateBps: resolution.rateBps,
      taxLabel: resolution.label,
      amount: taxable + taxAmount,
    };
  }

  // Country has no tax, or reverse-charge applies — clear the tax breakdown
  // but keep the subtotal snapshot so the base survives later changes.
  return {
    subtotalAmount: subtotal,
    taxAmount: 0n,
    taxRateBps: null,
    taxLabel: null,
    amount: taxable,
  };
}

// Allow POST as an alias for PATCH (needed for navigator.sendBeacon)
export const POST = PATCH;
