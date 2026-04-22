import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { verifyPortalToken } from "@/lib/portal-tokens";

/**
 * Customer-initiated scheduled cancellation. Flips cancel_at_period_end
 * on their subscription but keeps it active until next_charge_date —
 * the keeper flips to cancelled then. Customer can undo via
 * /api/portal/resume-schedule before the boundary.
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
  if (sub.status !== "active") {
    return NextResponse.json(
      {
        error: {
          code: "invalid_status",
          message: "Only active subscriptions can be scheduled for cancellation",
        },
      },
      { status: 409 },
    );
  }
  if (!sub.nextChargeDate) {
    return NextResponse.json(
      { error: { code: "missing_period", message: "Subscription has no scheduled next charge" } },
      { status: 409 },
    );
  }

  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: true, cancelScheduledAt: new Date() })
    .where(eq(subscriptions.id, subscriptionId));

  return NextResponse.json({
    ok: true,
    cancelAt: sub.nextChargeDate.toISOString(),
  });
}
