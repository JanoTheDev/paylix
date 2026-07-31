import { createHmac, timingSafeEqual } from "crypto";

/**
 * HMAC keys for customer-facing, cookie-less links (billing portal +
 * one-click unsubscribe).
 *
 * There is deliberately NO fallback value here. A hardcoded default would
 * ship a signing key in the public repo, which lets anyone forge a token for
 * an arbitrary customer UUID and read that customer's billing history.
 * A deployment without the secret must refuse to sign or verify.
 */
const MIN_SECRET_LENGTH = 32;

function readSecret(...envKeys: string[]): string {
  for (const key of envKeys) {
    const raw = process.env[key];
    if (!raw) continue;
    if (raw.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `${key} must be at least ${MIN_SECRET_LENGTH} characters to sign customer portal tokens`,
      );
    }
    return raw;
  }
  throw new Error(
    `${envKeys[0]} is required to sign or verify customer portal tokens`,
  );
}

/** Portal links stay pinned to BETTER_AUTH_SECRET so existing links keep working. */
function getPortalSecret(): string {
  return readSecret("BETTER_AUTH_SECRET");
}

/** Unsubscribe links may use a dedicated key, falling back to the auth secret. */
function getUnsubscribeSecret(): string {
  return readSecret("PORTAL_TOKEN_SECRET", "BETTER_AUTH_SECRET");
}

/**
 * Constant-time hex digest comparison. Returns false (deny) for anything
 * that isn't a well-formed digest of the expected length, so a malformed
 * signature can never short-circuit into a match.
 */
function hexDigestEquals(expectedHex: string, providedHex: string): boolean {
  if (typeof providedHex !== "string") return false;
  if (providedHex.length !== expectedHex.length) return false;
  if (!/^[0-9a-f]+$/i.test(providedHex)) return false;
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(providedHex, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * Deny-on-misconfiguration wrapper. Verification must never throw out of a
 * route (that would surface a 500 and leak the reason), but it must also
 * never succeed when the key is missing.
 */
function safeVerify(fn: () => boolean): boolean {
  try {
    return fn();
  } catch (err) {
    console.error(
      "[portal-tokens] verification denied:",
      err instanceof Error ? err.message : "unknown error",
    );
    return false;
  }
}

export function signPortalToken(customerId: string): string {
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const payload = `${customerId}.${exp}`;
  const sig = createHmac("sha256", getPortalSecret())
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyPortalToken(token: string, customerId: string): boolean {
  return safeVerify(() => {
    if (typeof token !== "string" || !token || typeof customerId !== "string") {
      return false;
    }
    // Resolve the key first: a missing secret must deny, not fall through to
    // a comparison against a token nobody could have produced.
    const secret = getPortalSecret();
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split(".");
    if (parts.length !== 3) return false;
    const [tokenCustomerId, expStr, sig] = parts;
    if (tokenCustomerId !== customerId) return false;
    if (!/^\d+$/.test(expStr)) return false;
    const exp = Number.parseInt(expStr, 10);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const expected = createHmac("sha256", secret)
      .update(`${tokenCustomerId}.${expStr}`)
      .digest("hex");
    return hexDigestEquals(expected, sig);
  });
}

/**
 * One-click unsubscribe token: `<customerId>.<category>.<hmac>`. Shared here
 * so `app/api/public/unsubscribe` stops hand-rolling the same HMAC with an
 * empty-string key fallback.
 */
export function signUnsubscribeToken(
  customerId: string,
  category: string,
): string {
  const sig = createHmac("sha256", getUnsubscribeSecret())
    .update(`${customerId}.${category}`)
    .digest("hex");
  return `${customerId}.${category}.${sig}`;
}

export function verifyUnsubscribeToken(
  token: string,
  allowedCategories: readonly string[],
): { customerId: string; category: string } | null {
  let result: { customerId: string; category: string } | null = null;
  safeVerify(() => {
    if (typeof token !== "string" || !token) return false;
    const secret = getUnsubscribeSecret();
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [customerId, category, provided] = parts;
    if (!customerId || !allowedCategories.includes(category)) return false;
    const expected = createHmac("sha256", secret)
      .update(`${customerId}.${category}`)
      .digest("hex");
    if (!hexDigestEquals(expected, provided)) return false;
    result = { customerId, category };
    return true;
  });
  return result;
}
