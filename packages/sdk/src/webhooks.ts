import {
  hmacSha256Hex,
  hmacSha256HexAsync,
  timingSafeEqualHex,
  toBytes,
} from "./hmac";
import type { WebhookVerifyParams } from "./types";

const DEFAULT_MAX_AGE = 300; // 5 minutes

const decoder = new TextDecoder("utf-8");

function payloadString(payload: string | Uint8Array): string {
  return typeof payload === "string" ? payload : decoder.decode(toBytes(payload));
}

/**
 * What to HMAC and what to compare it against.
 *
 * Everything except the digest itself — header parsing, format detection,
 * and the freshness window — is decided here, so `verify` and `verifyAsync`
 * cannot drift apart on anything but which HMAC they call. `null` means
 * "reject without hashing".
 */
interface Challenge {
  input: string;
  provided: string;
}

function buildChallenge(params: WebhookVerifyParams): Challenge | null {
  const {
    payload,
    signature,
    maxAgeSeconds = DEFAULT_MAX_AGE,
    nowSeconds,
  } = params;

  if (!signature) return null;

  const body = payloadString(payload);
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);

  // Timestamped format: t=<unix>,v1=<hex>
  if (signature.includes("t=") && signature.includes("v1=")) {
    const parts = signature.split(",").map((s) => s.trim());
    let ts: string | null = null;
    let v1: string | null = null;
    for (const p of parts) {
      if (p.startsWith("t=")) ts = p.slice(2);
      else if (p.startsWith("v1=")) v1 = p.slice(3);
    }
    if (!ts || !v1) return null;

    const t = Number(ts);
    if (!Number.isFinite(t) || t <= 0) return null;
    if (Math.abs(now - t) > maxAgeSeconds) return null;

    return { input: `${ts}.${body}`, provided: v1 };
  }

  // Legacy sha256= fallback
  if (!signature.startsWith("sha256=")) return null;
  return { input: body, provided: signature.slice(7) };
}

/**
 * Webhook signature verification.
 *
 * Two entry points with identical arguments and results:
 * {@link webhooks.verifyAsync} (preferred — defers the HMAC to the
 * platform's `crypto.subtle`) and {@link webhooks.verify} (synchronous,
 * uses the bundled HMAC).
 *
 * Neither reaches for `node:crypto`, so this module is safe to import from
 * Next.js edge routes, Cloudflare Workers, Deno, Bun, and browser bundles
 * as well as Node.
 *
 * Also available on its own entry point — `import { webhooks } from
 * '@paylix/sdk/webhooks'` — when you want signature checking without
 * pulling in the HTTP client.
 */
export const webhooks = {
  /**
   * Verifies a Paylix webhook signature. Supports two header formats:
   *
   *   t=<unix_seconds>,v1=<hmac of "t.body">
   *     — replay-protected. Max age enforced via `maxAgeSeconds`
   *       (default 300s). This is the format new Paylix deployments emit.
   *
   *   sha256=<hmac of body>
   *     — legacy format, accepted for backwards compatibility. Carries
   *       no timestamp so cannot be replay-protected. Will be removed
   *       in a future SDK major release.
   *
   * Pass the **raw** body. Re-serializing a parsed object changes key
   * order and produces a different digest.
   *
   * @returns `true` only when the signature is valid and, for the v1
   * format, within the freshness window. Never throws.
   *
   * @example
   * ```ts
   * const ok = webhooks.verify({
   *   payload: rawBody,
   *   signature: req.headers['x-paylix-signature'],
   *   secret: process.env.PAYLIX_WEBHOOK_SECRET!,
   * })
   * if (!ok) return res.status(400).end()
   * ```
   */
  verify(params: WebhookVerifyParams): boolean {
    const challenge = buildChallenge(params);
    if (!challenge) return false;
    return timingSafeEqualHex(
      hmacSha256Hex(params.secret, challenge.input),
      challenge.provided,
    );
  },

  /**
   * Identical to {@link webhooks.verify}, but computes the HMAC with the
   * platform's `crypto.subtle` instead of the bundled implementation.
   *
   * **Prefer this when you can `await`.** It defers the primitive to an
   * audited, usually native implementation; `verify` exists because
   * `crypto.subtle` is async-only and the synchronous signature is part of
   * the published contract.
   *
   * Same inputs, same result, same never-throws-on-bad-input behaviour —
   * except that it rejects if the runtime has no `crypto.subtle` at all
   * (pre-18 Node, or a browser on an insecure origin), in which case fall
   * back to `verify`.
   *
   * @example
   * ```ts
   * if (!(await webhooks.verifyAsync({ payload: rawBody, signature, secret }))) {
   *   return new Response('bad signature', { status: 400 })
   * }
   * ```
   */
  async verifyAsync(params: WebhookVerifyParams): Promise<boolean> {
    const challenge = buildChallenge(params);
    if (!challenge) return false;
    return timingSafeEqualHex(
      await hmacSha256HexAsync(params.secret, challenge.input),
      challenge.provided,
    );
  },
};

export type { WebhookVerifyParams, WebhookEvent } from "./types";
