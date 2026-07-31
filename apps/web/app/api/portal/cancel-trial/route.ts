import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import {
  requirePortalCustomer,
  requireOwnedSubscription,
} from "@/lib/portal-auth";
import { dispatchWebhooks } from "@/lib/webhook-dispatch";
import { readPortalSubscriptionId } from "../_shared-body";

/**
 * Customer-initiated trial cancellation via portal token. Pure DB state
 * change — no on-chain action since trialing subscriptions have never
 * been charged. Customers can only cancel BEFORE a conversion failure;
 * once trial_conversion_failed, the merchant must retry or cancel.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const portal = await requirePortalCustomer(request, body);
  if (!portal.ok) return portal.response;

  const subscriptionId = readPortalSubscriptionId(body);
  const owned = await requireOwnedSubscription(portal.customerId, subscriptionId);
  if (!owned.ok) return owned.response;
  const sub = owned.subscription;

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

  void dispatchWebhooks(sub.organizationId, "subscription.trial_cancelled", {
    subscriptionId,
    productId: sub.productId,
    customerId: sub.customerId,
    subscriberAddress: sub.subscriberAddress,
    trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
    cancelledBy: "customer",
    cancelledAt: new Date().toISOString(),
    metadata: sub.metadata ?? {},
  }, sub.livemode).catch((err) => console.error("[portal cancel-trial] webhook failed:", err));

  return NextResponse.json({ ok: true });
}
