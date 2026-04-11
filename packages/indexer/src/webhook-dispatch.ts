import { createDb } from "@paylix/db/client";
import { webhooks, webhookDeliveries } from "@paylix/db/schema";
import { eq, and, lte, lt, isNotNull } from "drizzle-orm";
import { createHmac } from "crypto";
import { config } from "./config";
import { validateWebhookUrl } from "./url-safety";

const db = createDb(config.databaseUrl);

export async function dispatchWebhooks(
  organizationId: string,
  event: string,
  data: Record<string, unknown>
) {
  if (!organizationId) return;

  const userWebhooks = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.organizationId, organizationId), eq(webhooks.isActive, true)));

  const matchingWebhooks = userWebhooks.filter((wh) =>
    wh.events.includes(event)
  );

  // Compute the timestamp once so the signed bytes match the persisted
  // payload exactly.
  const timestamp = new Date().toISOString();
  const eventPayload = { event, timestamp, data };
  const payload = JSON.stringify(eventPayload);

  for (const wh of matchingWebhooks) {
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
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

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

    const payload = JSON.stringify(delivery.payload);
    const newAttempt = delivery.attempts + 1;
    const signature = `sha256=${createHmac("sha256", webhook.secret).update(payload).digest("hex")}`;

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
    } catch {
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
