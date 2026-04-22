import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";

const schema = z.object({
  days: z.number().int().min(1).max(365),
});

/**
 * Admin-only: bump trial_ends_at by N days. Valid on trialing or
 * trial_conversion_failed subs. The trial converter skips the sub
 * until the new date. Use this for support overrides — extending a
 * trial is cheaper than refunding the first real charge.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      "validation_failed",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

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
  if (
    existing.status !== "trialing" &&
    existing.status !== "trial_conversion_failed"
  ) {
    return apiError(
      "invalid_status",
      "Only trialing or failed-trial subscriptions can have their trial extended",
      409,
    );
  }

  const base = existing.trialEndsAt ?? new Date();
  const newEndsAt = new Date(base.getTime() + parsed.data.days * 24 * 60 * 60 * 1000);

  const patch: Record<string, unknown> = { trialEndsAt: newEndsAt };
  // If we're reviving a failed-conversion sub, flip it back to trialing
  // so the converter will pick it up at the new boundary.
  if (existing.status === "trial_conversion_failed") {
    patch.status = "trialing";
    patch.trialConversionAttempts = 0;
    patch.trialConversionLastError = null;
  }

  const [updated] = await db
    .update(subscriptions)
    .set(patch)
    .where(eq(subscriptions.id, id))
    .returning();

  void recordAudit({
    organizationId,
    userId,
    action: "subscription.trial_extended",
    resourceType: "subscription",
    resourceId: id,
    details: { days: parsed.data.days, newEndsAt: newEndsAt.toISOString() },
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json({ success: true, trialEndsAt: updated.trialEndsAt });
}
