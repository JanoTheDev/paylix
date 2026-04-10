import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";

// Force-cancel: DB-only update. Used as a manual fallback when the on-chain
// cancel transaction cannot be executed. The normal flow is for the merchant
// (or subscriber via the customer portal) to call
// SubscriptionManager.cancelSubscription(onChainId) directly from their wallet,
// and for the indexer to pick up the SubscriptionCancelled event and update
// the DB row.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [updated] = await db
    .update(subscriptions)
    .set({ status: "cancelled" })
    .where(
      and(eq(subscriptions.id, id), eq(subscriptions.userId, session.user.id))
    )
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
