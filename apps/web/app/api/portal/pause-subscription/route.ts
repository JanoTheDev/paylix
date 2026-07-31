import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import {
  requirePortalCustomer,
  requireOwnedSubscription,
} from "@/lib/portal-auth";
import { readPortalSubscriptionId } from "../_shared-body";
import { computePauseUpdate } from "../../subscriptions/[id]/pause/logic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const portal = await requirePortalCustomer(request, body);
  if (!portal.ok) return portal.response;

  const subscriptionId = readPortalSubscriptionId(body);
  const owned = await requireOwnedSubscription(portal.customerId, subscriptionId);
  if (!owned.ok) return owned.response;
  const sub = owned.subscription;

  const result = computePauseUpdate(sub, "customer", new Date());
  if (!result.ok) {
    return NextResponse.json({ error: { code: "invalid_state", message: result.reason } }, { status: 409 });
  }

  await db.update(subscriptions).set(result.update).where(eq(subscriptions.id, subscriptionId));

  return NextResponse.json({ success: true });
}
