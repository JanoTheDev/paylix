import { createDb } from "@paylix/db/client";
import { webhooks, webhookDeliveries } from "@paylix/db/schema";
import { eq, and, lte, lt, isNotNull } from "drizzle-orm";
import { createHmac } from "crypto";
import { config } from "./config";
import { validateWebhookUrl } from "./url-safety";
import { buildEnvelope } from "./webhook-envelope";
export { buildEnvelope, type EnvelopeInput, type Envelope } from "./webhook-envelope";

const db = createDb(config.databaseUrl);

const urlDeliveryCounts = new Map<string, { count: number; resetAt: number }>();

// Endpoints get rotated and merchants come and go; without eviction the map is
// a slow leak in a process expected to run for months.
const RATE_LIMIT_SWEEP_MS = 10 * 60_000;
let lastRateLimitSweep = Date.now();

function sweepRateLimitWindows(now: number) {
  if (now - lastRateLimitSweep < RATE_LIMIT_SWEEP_MS) return;
  lastRateLimitSweep = now;
  for (const [url, entry] of urlDeliveryCounts) {
    if (entry.resetAt < now) urlDeliveryCounts.delete(url);
  }
}

function isUrlRateLimited(url: string, maxPerMinute = 10): boolean {
  const now = Date.now();
  sweepRateLimitWindows(now);
  const entry = urlDeliveryCounts.get(url);
  if (!entry || entry.resetAt < now) {
    urlDeliveryCounts.set(url, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > maxPerMinute;
}

/**
 * The one place a webhook signature is built. First delivery and retry MUST
 * produce the same scheme over the same bytes, otherwise every receiver that
 * implements the documented verification rejects 100% of retries.
 *
 * Format: `t=<unix seconds>,v1=HMAC_SHA256(secret, "<t>.<payload>")` — the
 * timestamp lets receivers enforce a replay window.
 */
export function signWebhookPayload(secret: string, payload: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", secret)
    .update(`${ts}.${payload}`)
    .digest("hex");
  return `t=${ts},v1=${digest}`;
}

export async function dispatchWebhooks(
  organizationId: string,
  event: string,
  data: Record<string, unknown>,
  livemode: boolean
) {
  if (!organizationId) return;

  // livemode must be part of the query: a merchant with both a test and a live
  // endpoint registered would otherwise receive live payment events on the test
  // endpoint and vice versa.
  const userWebhooks = await db
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.organizationId, organizationId),
        eq(webhooks.isActive, true),
        eq(webhooks.livemode, livemode),
      ),
    );

  const matchingWebhooks = userWebhooks.filter((wh) =>
    wh.events.includes(event)
  );

  const eventPayload = buildEnvelope({ eventType: event, data, livemode });
  const payload = JSON.stringify(eventPayload);

  for (const wh of matchingWebhooks) {
    if (isUrlRateLimited(wh.url)) {
      // Persist the delivery as failed-with-retry instead of dropping it —
      // a burst over the per-URL limit must drain later, not vanish.
      console.warn(`[Webhook] Rate limited URL ${wh.url}, queueing ${event} for retry`);
      await db.insert(webhookDeliveries).values({
        webhookId: wh.id,
        event,
        payload: eventPayload,
        status: "failed",
        attempts: 0,
        nextRetryAt: getNextRetryTime(1),
      });
      continue;
    }

    const urlError = await validateWebhookUrl(wh.url);
    if (urlError) {
      await db.insert(webhookDeliveries).values({
        webhookId: wh.id,
        event,
        payload: eventPayload,
        status: "failed",
        attempts: 1,
      });
      continue;
    }

    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        webhookId: wh.id,
        event,
        payload: eventPayload,
        status: "pending",
        attempts: 0,
      })
      .returning();

    await attemptDelivery(wh.url, wh.secret, payload, delivery.id);
  }
}

async function attemptDelivery(
  url: string,
  secret: string,
  payload: string,
  deliveryId: string
) {
  const signature = signWebhookPayload(secret, payload);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paylix-signature": signature,
        "User-Agent": "Paylix-Webhook/1.0",
      },
      body: payload,
      signal: AbortSignal.timeout(10000),
    });

    await db
      .update(webhookDeliveries)
      .set({
        status: response.ok ? "delivered" : "failed",
        httpStatus: response.status,
        attempts: 1,
        nextRetryAt: response.ok ? null : getNextRetryTime(1),
      })
      .where(eq(webhookDeliveries.id, deliveryId));
  } catch (error) {
    console.error(
      `[Webhook] Delivery ${deliveryId} to ${url} failed:`,
      error instanceof Error ? error.message : error,
    );
    await db
      .update(webhookDeliveries)
      .set({
        status: "failed",
        attempts: 1,
        nextRetryAt: getNextRetryTime(1),
      })
      .where(eq(webhookDeliveries.id, deliveryId));
  }
}

export function getNextRetryTime(attempt: number): Date {
  const delays = [60, 300, 1800, 7200, 43200];
  const delaySec = delays[Math.min(attempt - 1, delays.length - 1)];
  return new Date(Date.now() + delaySec * 1000);
}

/**
 * Dispatches a system-level webhook event to ALL active webhooks across
 * ALL users that have subscribed to the given event name. Used for
 * operational alerts (relayer balance low, keeper balance low) where the
 * event isn't tied to a specific user's payment flow but is interesting to
 * every operator running the instance.
 *
 * Self-hosters can subscribe any webhook to "system.*" events and they'll
 * receive notifications about their deployment's health.
 *
 * Deliberately NOT filtered by livemode: a system event describes the
 * deployment, not a merchant's live or test data, so both endpoint kinds are
 * valid subscribers. The cross-organization fan-out is likewise intentional
 * (operator alerts), and is why only opt-in "system.*" event names reach here.
 */
export async function dispatchSystemWebhook(
  event: string,
  data: Record<string, unknown>,
) {
  const allWebhooks = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.isActive, true));

  const matching = allWebhooks.filter((wh) => wh.events.includes(event));
  if (matching.length === 0) {
    console.log(`[Webhook] No subscribers for ${event}, skipping dispatch`);
    return;
  }

  const timestamp = new Date().toISOString();
  const eventPayload = { event, timestamp, data };
  const payload = JSON.stringify(eventPayload);

  for (const wh of matching) {
    if (isUrlRateLimited(wh.url)) {
      console.warn(`[Webhook] Rate limited URL ${wh.url}, queueing ${event} for retry`);
      await db.insert(webhookDeliveries).values({
        webhookId: wh.id,
        event,
        payload: eventPayload,
        status: "failed",
        attempts: 0,
        nextRetryAt: getNextRetryTime(1),
      });
      continue;
    }

    const urlError = await validateWebhookUrl(wh.url);
    if (urlError) {
      await db.insert(webhookDeliveries).values({
        webhookId: wh.id,
        event,
        payload: eventPayload,
        status: "failed",
        attempts: 1,
      });
      continue;
    }

    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        webhookId: wh.id,
        event,
        payload: eventPayload,
        status: "pending",
        attempts: 0,
      })
      .returning();

    await attemptDelivery(wh.url, wh.secret, payload, delivery.id);
  }
}

export async function retryFailedWebhooks() {
  const now = new Date();
  const failedDeliveries = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, "failed"),
        isNotNull(webhookDeliveries.nextRetryAt),
        lte(webhookDeliveries.nextRetryAt, now),
        lt(webhookDeliveries.attempts, 5)
      )
    )
    .limit(50);

  for (const delivery of failedDeliveries) {
    const [webhook] = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, delivery.webhookId));
    if (!webhook || !webhook.isActive) continue;

    if (isUrlRateLimited(webhook.url)) {
      console.warn(`[Webhook] Rate limited URL ${webhook.url}, skipping retry`);
      continue;
    }

    // Sign the exact bytes we are about to send, with the same scheme as the
    // first delivery — a retry signed differently is rejected by every
    // conforming receiver, so a webhook that failed once could never succeed.
    const payload = JSON.stringify(delivery.payload);
    const newAttempt = delivery.attempts + 1;
    const signature = signWebhookPayload(webhook.secret, payload);

    const urlError = await validateWebhookUrl(webhook.url);
    if (urlError) {
      await db
        .update(webhookDeliveries)
        .set({
          status: "failed",
          attempts: newAttempt,
          nextRetryAt: null,
        })
        .where(eq(webhookDeliveries.id, delivery.id));
      continue;
    }

    try {
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paylix-signature": signature,
          "User-Agent": "Paylix-Webhook/1.0",
        },
        body: payload,
        signal: AbortSignal.timeout(10000),
      });

      await db
        .update(webhookDeliveries)
        .set({
          status: response.ok ? "delivered" : "failed",
          httpStatus: response.status,
          attempts: newAttempt,
          nextRetryAt: response.ok ? null : getNextRetryTime(newAttempt),
        })
        .where(eq(webhookDeliveries.id, delivery.id));
    } catch (error) {
      console.error(
        `[Webhook] Retry ${newAttempt} of delivery ${delivery.id} to ${webhook.url} failed:`,
        error instanceof Error ? error.message : error,
      );
      await db
        .update(webhookDeliveries)
        .set({
          attempts: newAttempt,
          nextRetryAt: getNextRetryTime(newAttempt),
        })
        .where(eq(webhookDeliveries.id, delivery.id));
    }
  }
}
