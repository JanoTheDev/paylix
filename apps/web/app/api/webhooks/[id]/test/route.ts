import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { webhooks, webhookDeliveries } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { createHmac } from "crypto";
import { validateWebhookUrl } from "@/lib/url-safety";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const { id } = await params;

  const [webhook] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), orgScope(webhooks, { organizationId, livemode })));

  if (!webhook) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const urlError = await validateWebhookUrl(webhook.url);
  if (urlError) {
    return NextResponse.json({ error: urlError }, { status: 400 });
  }

  const payload = {
    id: "evt_test_" + Date.now(),
    type: "payment.confirmed",
    data: {
      id: "pay_test_123",
      amount: 1000,
      currency: "USDC",
      status: "confirmed",
      txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      createdAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  };

  const payloadStr = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", webhook.secret)
    .update(`${timestamp}.${payloadStr}`)
    .digest("hex");

  let httpStatus: number | null = null;
  let deliveryStatus: "delivered" | "failed" = "failed";

  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Paylix-Signature": `t=${timestamp},v1=${signature}`,
        "X-Paylix-Event": "payment.confirmed",
      },
      body: payloadStr,
      signal: AbortSignal.timeout(10000),
    });
    httpStatus = res.status;
    deliveryStatus = res.ok ? "delivered" : "failed";
  } catch {
    httpStatus = null;
    deliveryStatus = "failed";
  }

  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      webhookId: webhook.id,
      event: "payment.confirmed",
      payload,
      status: deliveryStatus,
      httpStatus,
      attempts: 1,
    })
    .returning();

  return NextResponse.json(delivery);
}
