import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { dispatchWebhooks } from "@/lib/webhook-dispatch";

const cancelSchema = z
  .object({ when: z.enum(["immediate", "period_end"]).optional() })
  .optional();

/**
 * Cancel a subscription.
 *   when = "immediate" (default): flip status to cancelled now.
 *   when = "period_end": schedule cancellation for next_charge_date — the
 *     keeper flips the row when the period boundary passes. Only valid on
 *     active subs (not trialing / past_due / paused / cancelled). Customer
 *     or merchant can call POST /resume-schedule to undo before then.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("validation_failed", "Invalid cancel options");
  }
  const when = parsed.data?.when ?? "immediate";

  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, id),
        orgScope(subscriptions, { organizationId, livemode }),
      ),
    )
    .limit(1);
  if (!existing) return apiError("not_found", "Subscription not found", 404);

  if (when === "period_end") {
    if (existing.status !== "active") {
      return apiError(
        "invalid_status",
        "Only active subscriptions can be cancelled at period end",
        409,
      );
    }
    if (!existing.nextChargeDate) {
      return apiError(
        "missing_period",
        "Subscription has no scheduled next charge",
        409,
      );
    }
    await db
      .update(subscriptions)
      .set({
        cancelAtPeriodEnd: true,
        cancelScheduledAt: new Date(),
      })
      .where(eq(subscriptions.id, id));

    void recordAudit({
      organizationId,
      userId,
      action: "subscription.cancel_scheduled",
      resourceType: "subscription",
      resourceId: id,
      details: { cancelAt: existing.nextChargeDate.toISOString() },
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

    return NextResponse.json({
      success: true,
      cancelAtPeriodEnd: true,
      cancelAt: existing.nextChargeDate.toISOString(),
    });
  }

  const [updated] = await db
    .update(subscriptions)
    .set({ status: "cancelled", cancelAtPeriodEnd: false })
    .where(eq(subscriptions.id, id))
    .returning();

  void recordAudit({
    organizationId,
    userId,
    action: "subscription.cancelled",
    resourceType: "subscription",
    resourceId: id,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  void dispatchWebhooks(organizationId, "subscription.cancelled", {
    subscriptionId: updated.id,
    onChainId: updated.onChainId,
    status: "cancelled",
    metadata: updated.metadata ?? {},
  }).catch((err) => console.error("[cancel] webhook failed:", err));

  return NextResponse.json({ success: true });
}
