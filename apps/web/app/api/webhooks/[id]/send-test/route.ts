import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { webhooks } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
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
import { deliverWebhook } from "@/lib/webhook-dispatch";
import { parseJsonBody, parseWith } from "../../../_shared/http";

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
    const body = parseJsonBody(rawBody);
    if (!body.ok) return body.response;
    const parsed = parseWith(sendTestSchema, body.data);
    if (!parsed.ok) return parsed.response;
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

  // One shared sender for every outbound webhook: signs, records the
  // delivery row (with livemode), re-validates the URL immediately before
  // the request, and refuses to follow redirects — so a registered-then-
  // redirected endpoint can't steer us at an internal address.
  const result = await deliverWebhook({ webhook, event, envelope });

  if (!result.ok) {
    return NextResponse.json(
      {
        deliveryId: result.deliveryId,
        eventId,
        status: "failed",
        httpStatus: result.httpStatus,
        error: result.error,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    deliveryId: result.deliveryId,
    eventId,
    status: "delivered",
    httpStatus: result.httpStatus,
  });
  });
}
