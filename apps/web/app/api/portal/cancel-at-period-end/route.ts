import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import {
  requirePortalCustomer,
  requireOwnedSubscription,
} from "@/lib/portal-auth";
import { readPortalSubscriptionId } from "../_shared-body";

/**
 * Customer-initiated scheduled cancellation. Flips cancel_at_period_end
 * on their subscription but keeps it active until next_charge_date —
 * the keeper flips to cancelled then. Customer can undo via
 * /api/portal/resume-schedule before the boundary.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const portal = await requirePortalCustomer(request, body);
  if (!portal.ok) return portal.response;

  const subscriptionId = readPortalSubscriptionId(body);
  const owned = await requireOwnedSubscription(portal.customerId, subscriptionId);
  if (!owned.ok) return owned.response;
  const sub = owned.subscription;

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
