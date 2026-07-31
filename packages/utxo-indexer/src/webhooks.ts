/**
 * Webhook dispatch for the UTXO indexer.
 *
 * The EVM indexer's `packages/indexer/src/webhook-dispatch.ts` is a separate
 * service module bound to its own config and DB handle, so the delivery
 * contract is reproduced here rather than imported: the same envelope shape,
 * the same `t=<ts>,v1=<hmac>` signature over `<ts>.<payload>`, and the same
 * `webhook_deliveries` row so the EVM process's retry sweep drains failures
 * from this path too. If the signature scheme changes, change it in both.
 *
 * Dispatch is best-effort and never unwinds a recorded payment: callers log
 * and continue. A delivery that fails is persisted with `nextRetryAt` set so
 * it is retried rather than lost.
 */

import { createHmac } from "node:crypto";
import { resolve4, resolve6 } from "node:dns/promises";
import { and, eq } from "drizzle-orm";
import type { Database } from "@paylix/db/client";
import { webhooks, webhookDeliveries } from "@paylix/db/schema";

const DELIVERY_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_SEC = [60, 300, 1800, 7200, 43200];

export function getNextRetryTime(attempt: number): Date {
  const delaySec = RETRY_DELAYS_SEC[Math.min(attempt - 1, RETRY_DELAYS_SEC.length - 1)];
  return new Date(Date.now() + delaySec * 1000);
}

const BLOCKED_CIDRS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^192\.0\.0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
  /^0\./,
  /^::1$/,
  /^fe80::/i,
  /^f[cd][0-9a-f]{2}:/i,
];

/** Normalize IPv4-mapped IPv6 (`::ffff:127.0.0.1`) before range matching. */
function isBlockedIp(ip: string): boolean {
  const normalized = ip.replace(/^::ffff:/i, "");
  return BLOCKED_CIDRS.some((re) => re.test(normalized));
}

/** Returns a rejection reason, or null when the URL is safe to call. */
export async function validateWebhookUrl(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL";
  }

  const isProd = process.env.NODE_ENV === "production";
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Only http/https allowed";
  }
  if (parsed.protocol !== "https:" && isProd) return "HTTPS required";

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost") return isProd ? "localhost not allowed" : null;

  // Resolve every A/AAAA record, not just the first — a host publishing both
  // a public and a private address must not slip through on the public one.
  const addresses: string[] = [];
  const results = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
  for (const r of results) {
    if (r.status === "fulfilled") addresses.push(...r.value);
  }
  if (addresses.length === 0) {
    // A literal IP host never resolves; fall back to matching it directly.
    if (/^[[\]0-9a-f.:]+$/i.test(hostname)) {
      addresses.push(hostname.replace(/^\[|\]$/g, ""));
    } else {
      return "Could not resolve hostname";
    }
  }
  if (addresses.some(isBlockedIp)) {
    return isProd ? "Private/internal IPs not allowed" : null;
  }

  return null;
}

export interface Envelope {
  event: string;
  timestamp: string;
  livemode: boolean;
  data: unknown;
}

/**
 * Deliver `event` to every active webhook the organization has registered for
 * this livemode. Resolves once all deliveries have been attempted; individual
 * failures are recorded, not thrown.
 */
export async function dispatchWebhooks(
  db: Database,
  organizationId: string,
  event: string,
  data: Record<string, unknown>,
  livemode: boolean,
): Promise<void> {
  if (!organizationId) return;

  const registered = await db
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.organizationId, organizationId),
        eq(webhooks.isActive, true),
        // Test endpoints must never receive live events, and vice versa.
        eq(webhooks.livemode, livemode),
      ),
    );

  const matching = registered.filter((wh) => wh.events.includes(event));
  if (matching.length === 0) return;

  const envelope: Envelope = {
    event,
    timestamp: new Date().toISOString(),
    livemode,
    data,
  };
  // Sign and send the exact same bytes we persist.
  const body = JSON.stringify(envelope);

  for (const wh of matching) {
    const urlError = await validateWebhookUrl(wh.url);
    if (urlError) {
      console.warn(`[utxo-webhooks] ${event} -> ${wh.url} rejected: ${urlError}`);
      await db.insert(webhookDeliveries).values({
        webhookId: wh.id,
        event,
        payload: envelope,
        status: "failed",
        attempts: 1,
        livemode,
      });
      continue;
    }

    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        webhookId: wh.id,
        event,
        payload: envelope,
        status: "pending",
        attempts: 0,
        livemode,
      })
      .returning();

    const ts = Math.floor(Date.now() / 1000);
    const signature = `t=${ts},v1=${createHmac("sha256", wh.secret)
      .update(`${ts}.${body}`)
      .digest("hex")}`;

    try {
      const response = await fetch(wh.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paylix-signature": signature,
          "User-Agent": "Paylix-Webhook/1.0",
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });

      await db
        .update(webhookDeliveries)
        .set({
          status: response.ok ? "delivered" : "failed",
          httpStatus: response.status,
          attempts: 1,
          nextRetryAt: response.ok ? null : getNextRetryTime(1),
        })
        .where(eq(webhookDeliveries.id, delivery.id));
    } catch (err) {
      console.error(`[utxo-webhooks] delivery ${delivery.id} to ${wh.url} failed:`, err);
      await db
        .update(webhookDeliveries)
        .set({ status: "failed", attempts: 1, nextRetryAt: getNextRetryTime(1) })
        .where(eq(webhookDeliveries.id, delivery.id));
    }
  }
}
