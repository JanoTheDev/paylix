import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { webhooks, webhookDeliveries } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { createHmac } from "crypto";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { apiError } from "@/lib/api-error";
import { checkRateLimitAsync } from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const { id } = await params;

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

  const payload = row.delivery.payload as Record<string, unknown>;
  const payloadString = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", row.webhook.secret)
    .update(payloadString)
    .digest("hex")}`;

  // New delivery row — never mutate the original. Status flips as the
  // fetch resolves.
  const [newDelivery] = await db
    .insert(webhookDeliveries)
    .values({
      webhookId: row.webhook.id,
      event: row.delivery.event,
      payload,
      status: "pending",
      attempts: 0,
      livemode: row.webhook.livemode,
    })
    .returning();

  try {
    const response = await fetch(row.webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paylix-signature": signature,
        "x-paylix-replay": "1",
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
      .where(eq(webhookDeliveries.id, newDelivery.id));
    return NextResponse.json({
      deliveryId: newDelivery.id,
      status: response.ok ? "delivered" : "failed",
      httpStatus: response.status,
    });
  } catch (err) {
    await db
      .update(webhookDeliveries)
      .set({ status: "failed", attempts: 1 })
      .where(eq(webhookDeliveries.id, newDelivery.id));
    return NextResponse.json(
      {
        deliveryId: newDelivery.id,
        status: "failed",
        error: err instanceof Error ? err.message : "Fetch failed",
      },
      { status: 502 },
    );
  }
}
