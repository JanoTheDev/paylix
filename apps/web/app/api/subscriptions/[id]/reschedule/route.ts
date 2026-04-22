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
  nextChargeDate: z.string().datetime(),
});

/**
 * Admin-only: override next_charge_date. Constrained to at most one
 * interval past the current period end so this can't be abused to
 * infinite-delay a subscription without explicit pause/cancel.
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
  if (existing.status !== "active" && existing.status !== "past_due") {
    return apiError(
      "invalid_status",
      "Only active or past-due subs can be rescheduled",
      409,
    );
  }
  if (!existing.intervalSeconds) {
    return apiError("missing_interval", "Subscription has no interval", 409);
  }

  const requested = new Date(parsed.data.nextChargeDate);
  const maxDate = existing.currentPeriodEnd
    ? new Date(
        existing.currentPeriodEnd.getTime() + existing.intervalSeconds * 1000,
      )
    : new Date(Date.now() + existing.intervalSeconds * 2 * 1000);
  if (requested.getTime() > maxDate.getTime()) {
    return apiError(
      "date_out_of_range",
      "nextChargeDate is more than one interval past current period end",
      409,
    );
  }

  await db
    .update(subscriptions)
    .set({ nextChargeDate: requested })
    .where(eq(subscriptions.id, id));

  void recordAudit({
    organizationId,
    userId,
    action: "subscription.rescheduled",
    resourceType: "subscription",
    resourceId: id,
    details: {
      previousNextChargeDate: existing.nextChargeDate?.toISOString() ?? null,
      newNextChargeDate: requested.toISOString(),
    },
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json({ success: true, nextChargeDate: requested });
}
