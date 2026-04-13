import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";

// Force-cancel: DB-only update. Used as a manual fallback when the on-chain
// cancel transaction cannot be executed. The normal flow is for the merchant
// (or subscriber via the customer portal) to call
// SubscriptionManager.cancelSubscription(onChainId) directly from their wallet,
// and for the indexer to pick up the SubscriptionCancelled event and update
// the DB row.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const { id } = await params;

  const [updated] = await db
    .update(subscriptions)
    .set({ status: "cancelled" })
    .where(
      and(eq(subscriptions.id, id), orgScope(subscriptions, { organizationId, livemode }))
    )
    .returning();

  if (!updated) {
    return NextResponse.json({ error: { code: "not_found", message: "Subscription not found" } }, { status: 404 });
  }

  void recordAudit({
    organizationId,
    userId,
    action: "subscription.cancelled",
    resourceType: "subscription",
    resourceId: id,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json({ success: true });
}
