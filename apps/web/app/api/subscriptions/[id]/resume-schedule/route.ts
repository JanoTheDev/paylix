import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";

/**
 * Undoes a scheduled cancellation. Valid only while the sub is still
 * active and cancel_at_period_end is set. Clears the flag + timestamp;
 * keeper goes back to charging as normal.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const { id } = await params;

  const [updated] = await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: false, cancelScheduledAt: null })
    .where(
      and(
        eq(subscriptions.id, id),
        eq(subscriptions.cancelAtPeriodEnd, true),
        eq(subscriptions.status, "active"),
        orgScope(subscriptions, { organizationId, livemode }),
      ),
    )
    .returning();

  if (!updated) {
    return apiError(
      "not_found",
      "No scheduled cancellation to resume",
      404,
    );
  }

  void recordAudit({
    organizationId,
    userId,
    action: "subscription.cancel_resumed",
    resourceType: "subscription",
    resourceId: id,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json({ success: true });
}
