import { createHmac, timingSafeEqual } from "crypto";
import type { WebhookVerifyParams } from "./types";

const DEFAULT_MAX_AGE = 300; // 5 minutes

function payloadString(payload: string | Buffer): string {
  return typeof payload === "string" ? payload : payload.toString("utf-8");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function verifyV1(
  secret: string,
  body: string,
  timestamp: string,
  signature: string,
  maxAge: number,
  now: number,
): boolean {
  const t = Number(timestamp);
  if (!Number.isFinite(t) || t <= 0) return false;
  if (Math.abs(now - t) > maxAge) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return safeEqual(expected, signature);
}

function verifyLegacy(secret: string, body: string, signature: string): boolean {
  if (!signature.startsWith("sha256=")) return false;
  const provided = signature.slice(7);
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  return safeEqual(expected, provided);
}

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
   */
  verify(params: WebhookVerifyParams): boolean {
    const {
      payload,
      signature,
      secret,
      maxAgeSeconds = DEFAULT_MAX_AGE,
      nowSeconds,
    } = params;
    const body = payloadString(payload);
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);

    if (!signature) return false;

    // Timestamped format: t=<unix>,v1=<hex>
    if (signature.includes("t=") && signature.includes("v1=")) {
      const parts = signature.split(",").map((s) => s.trim());
      let ts: string | null = null;
      let v1: string | null = null;
      for (const p of parts) {
        if (p.startsWith("t=")) ts = p.slice(2);
        else if (p.startsWith("v1=")) v1 = p.slice(3);
      }
      if (!ts || !v1) return false;
      return verifyV1(secret, body, ts, v1, maxAgeSeconds, now);
    }

    // Legacy sha256= fallback
    return verifyLegacy(secret, body, signature);
  },
};
