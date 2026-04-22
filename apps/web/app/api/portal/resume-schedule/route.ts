import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { verifyPortalToken } from "@/lib/portal-tokens";

/**
 * Undo a scheduled cancellation from the customer portal.
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
  if (!sub || sub.customerId !== customerId) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Subscription not found" } },
      { status: 404 },
    );
  }

  const [updated] = await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: false, cancelScheduledAt: null })
    .where(
      and(
        eq(subscriptions.id, subscriptionId),
        eq(subscriptions.cancelAtPeriodEnd, true),
        eq(subscriptions.status, "active"),
      ),
    )
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: { code: "not_scheduled", message: "No scheduled cancellation to resume" } },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
