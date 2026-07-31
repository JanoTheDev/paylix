import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { webhooks, webhookDeliveries } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { apiError } from "@/lib/api-error";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import { withIdempotency } from "@/lib/idempotency";
import {
  deliverWebhook,
  type WebhookEnvelope,
} from "@/lib/webhook-dispatch";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const { id } = await params;

  return withIdempotency(request, organizationId, async () => {
  // Resolve the original delivery scoped to this org via the webhook join.
  const [row] = await db
    .select({
      delivery: webhookDeliveries,
      webhook: webhooks,
    })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
    .where(
      and(
        eq(webhookDeliveries.id, id),
        eq(webhooks.organizationId, organizationId),
        eq(webhooks.livemode, livemode),
      ),
    )
    .limit(1);

  if (!row) return apiError("not_found", "Delivery not found", 404);

  // Per-webhook rate limit: 10 replays/min.
  const rl = await checkRateLimitAsync(`webhook-replay:${row.webhook.id}`, 10, 60_000);
  if (!rl.ok) {
    return apiError(
      "rate_limited",
      `Replay rate limit reached. Retry in ${Math.ceil((rl.retryAfterMs ?? 0) / 1000)}s`,
      429,
    );
  }

  // Replay the original envelope verbatim through the shared sender. It
  // re-validates the URL immediately before the request and refuses to
  // follow redirects — a replay is exactly the case where a registered URL
  // may have started pointing somewhere it shouldn't since it was stored.
  //
  // A brand-new delivery row is created; the original is never mutated.
  const envelope = row.delivery.payload as unknown as WebhookEnvelope;
  const result = await deliverWebhook({
    webhook: row.webhook,
    event: row.delivery.event,
    envelope,
    attempt: (row.delivery.attempts ?? 0) + 1,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        deliveryId: result.deliveryId,
        status: "failed",
        httpStatus: result.httpStatus,
        error: result.error,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    deliveryId: result.deliveryId,
    status: "delivered",
    httpStatus: result.httpStatus,
  });
  });
}
