import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import {
  requirePortalCustomer,
  requireOwnedSubscription,
} from "@/lib/portal-auth";
import { readPortalSubscriptionId } from "../_shared-body";

/**
 * Undo a scheduled cancellation from the customer portal.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const portal = await requirePortalCustomer(request, body);
  if (!portal.ok) return portal.response;

  const subscriptionId = readPortalSubscriptionId(body);
  const owned = await requireOwnedSubscription(portal.customerId, subscriptionId);
  if (!owned.ok) return owned.response;

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
