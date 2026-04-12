import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { verifyPortalToken } from "@/lib/portal-tokens";

/**
 * Customer-initiated trial cancellation via portal token. Pure DB state
 * change — no on-chain action since trialing subscriptions have never
 * been charged. Customers can only cancel BEFORE a conversion failure;
 * once trial_conversion_failed, the merchant must retry or cancel.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { subscriptionId, customerId, token } = body as {
    subscriptionId?: string;
    customerId?: string;
    token?: string;
  };

  if (!subscriptionId || !customerId || !token) {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "Missing subscriptionId, customerId, or token" } },
      { status: 400 },
    );
  }

  if (!verifyPortalToken(token, customerId)) {
    return NextResponse.json(
      { error: { code: "invalid_token", message: "Invalid or expired portal token" } },
      { status: 401 },
    );
  }

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);

  if (!sub) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Subscription not found" } },
      { status: 404 },
    );
  }

  if (sub.customerId !== customerId) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Not your subscription" } },
      { status: 403 },
    );
  }

  if (sub.status !== "trialing") {
    return NextResponse.json(
      { error: { code: "invalid_status", message: "Subscription is not trialing" } },
      { status: 409 },
    );
  }

  await db
    .update(subscriptions)
    .set({ status: "cancelled", pendingPermitSignature: null })
    .where(eq(subscriptions.id, subscriptionId));

  return NextResponse.json({ ok: true });
}
