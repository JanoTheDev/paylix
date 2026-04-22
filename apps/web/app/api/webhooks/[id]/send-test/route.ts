import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { webhooks, webhookDeliveries } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { createHmac, randomBytes } from "crypto";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { apiError } from "@/lib/api-error";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import {
  WEBHOOK_EVENT_TYPES,
  fixtureDataFor,
  type WebhookEventType,
} from "@/lib/webhook-test-fixtures";
import { withIdempotency } from "@/lib/idempotency";

const sendTestSchema = z.object({
  event: z.enum(WEBHOOK_EVENT_TYPES),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const { id } = await params;

  return withIdempotency(request, organizationId, async (rawBody) => {
    let body: unknown;
    try {
      body = rawBody.length > 0 ? JSON.parse(rawBody) : null;
    } catch {
      return apiError("invalid_body", "Request body must be valid JSON.", 400);
    }
    const parsed = sendTestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("validation_failed", "event is required", 400);
    }
    const event: WebhookEventType = parsed.data.event;

  // Per-org rate limit: 20 test events per minute.
  const rl = await checkRateLimitAsync(`webhook-test:${organizationId}`, 20, 60_000);
  if (!rl.ok) {
    return apiError(
      "rate_limited",
      `Test event rate limit reached. Retry in ${Math.ceil((rl.retryAfterMs ?? 0) / 1000)}s`,
      429,
    );
  }

  const [webhook] = await db
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.id, id),
        eq(webhooks.organizationId, organizationId),
        eq(webhooks.livemode, livemode),
      ),
    )
    .limit(1);

  if (!webhook) return apiError("not_found", "Webhook not found", 404);
  if (!webhook.events.includes(event)) {
    return apiError(
      "event_not_subscribed",
      `This webhook is not subscribed to ${event}`,
      409,
    );
  }

  const eventId = `evt_test_${randomBytes(8).toString("hex")}`;
  const envelope = {
    event,
    timestamp: new Date().toISOString(),
    // Test events are explicitly marked so receivers can drop them in prod.
    livemode: false,
    event_id: eventId,
    data: fixtureDataFor(event),
  };
  const payloadString = JSON.stringify(envelope);
  const ts = Math.floor(Date.now() / 1000);
  const signature = `t=${ts},v1=${createHmac("sha256", webhook.secret)
    .update(`${ts}.${payloadString}`)
    .digest("hex")}`;

  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      webhookId: webhook.id,
      event,
      payload: envelope,
      status: "pending",
      attempts: 0,
      livemode: webhook.livemode,
    })
    .returning();

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paylix-signature": signature,
        "x-paylix-test": "1",
        "User-Agent": "Paylix-Webhook/1.0",
      },
      body: payloadString,
      signal: AbortSignal.timeout(10_000),
    });
    await db
      .update(webhookDeliveries)
      .set({
        status: response.ok ? "delivered" : "failed",
        httpStatus: response.status,
        attempts: 1,
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    return NextResponse.json({
      deliveryId: delivery.id,
      eventId,
      status: response.ok ? "delivered" : "failed",
      httpStatus: response.status,
    });
  } catch (err) {
    await db
      .update(webhookDeliveries)
      .set({ status: "failed", attempts: 1 })
      .where(eq(webhookDeliveries.id, delivery.id));
    return NextResponse.json(
      {
        deliveryId: delivery.id,
        eventId,
        status: "failed",
        error: err instanceof Error ? err.message : "Fetch failed",
      },
      { status: 502 },
    );
  }
  });
}
