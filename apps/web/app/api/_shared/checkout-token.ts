/**
 * Per-session bearer token for the public checkout endpoints.
 *
 * The checkout session id is unguessable (122 random bits), but it is also
 * the only thing guarding `PATCH /api/checkout/[id]` — and it travels in the
 * URL bar, Referer headers, chat logs and screenshots. Anyone who obtains a
 * link could therefore overwrite the buyer's `buyerEmail` / names / phone /
 * `taxId` on a pending session, have those upserted onto the merchant's
 * `customers` row (so receipts and portal links follow the attacker), and
 * drive the tax recompute by supplying a zero-VAT `country`.
 *
 * The token is minted as an httpOnly cookie on `GET /api/checkout/[id]` —
 * which the checkout page always performs — and required on any write that
 * carries buyer details. No client change is needed: the browser attaches
 * the cookie automatically.
 *
 * Scope and limits, stated plainly:
 *  - `Path` is the session's own URL, so the cookie is never sent to another
 *    session's endpoints and one leaked cookie compromises one session.
 *  - `httpOnly` keeps it out of `document.cookie`, so an XSS on the checkout
 *    page can't read it.
 *  - `SameSite=Strict` means a cross-site POST can't carry it — which matters
 *    because `middleware.ts` exempts `/api/checkout` from the Origin check.
 *  - It is derived, not stored, so it does NOT stop an attacker who scripts a
 *    GET before the PATCH. Closing that requires a token minted at session
 *    creation and handed to the buyer's browser out-of-band; see
 *    `audit/_requests-web-api.md`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "paylix_checkout";

/** Slightly longer than the 30-minute session TTL, to absorb clock skew. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

function getSecret(): string {
  const secret =
    process.env.CHECKOUT_TOKEN_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "CHECKOUT_TOKEN_SECRET or BETTER_AUTH_SECRET (>=32 chars) is required to issue checkout session tokens",
    );
  }
  return secret;
}

function digest(sessionId: string, issuedAtMs: number): string {
  return createHmac("sha256", getSecret())
    .update(`${sessionId}.${issuedAtMs}`)
    .digest("hex");
}

/** `<issuedAtMs>.<hmac>`. Throws when the signing secret is unusable. */
export function signCheckoutToken(
  sessionId: string,
  now: Date = new Date(),
): string {
  const issuedAt = now.getTime();
  return `${issuedAt}.${digest(sessionId, issuedAt)}`;
}

function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  if (!/^[0-9a-f]+$/i.test(b)) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function verifyCheckoutToken(
  token: string | null | undefined,
  sessionId: string,
  now: Date = new Date(),
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [issuedAtRaw, provided] = parts;
  const issuedAt = Number.parseInt(issuedAtRaw, 10);
  if (!Number.isFinite(issuedAt)) return false;

  const age = now.getTime() - issuedAt;
  // Reject expired tokens and ones stamped in the future (clock tampering).
  if (age < -60_000 || age > TOKEN_TTL_MS) return false;

  try {
    return hexEquals(digest(sessionId, issuedAt), provided);
  } catch {
    // Missing/short secret — fail closed rather than accepting anything.
    return false;
  }
}

/** Minimal Cookie-header parser; route handlers get a plain `Request`. */
export function readCheckoutToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== COOKIE_NAME) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function checkoutCookieOptions(sessionId: string) {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    // Scoped to this session's own endpoints (and their sub-paths, e.g.
    // /relay, /apply-coupon) so it is never sent for a different session.
    path: `/api/checkout/${sessionId}`,
    maxAge: Math.floor(TOKEN_TTL_MS / 1000),
  };
}

export { COOKIE_NAME as CHECKOUT_COOKIE_NAME };
