import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { clientIp } from "../../../_shared/client-ip";
import { parseJsonBody, parseWith } from "../../../_shared/http";
import { requireRole } from "../../../_shared/roles";
import { withIdempotency } from "@/lib/idempotency";

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

  // "Admin-only" in the doc comment above was never enforced.
  const role = await requireRole(ctx);
  if (!role.ok) return role.response;

  const { id } = await params;

  // The target date is absolute, so a replay is not itself harmful — but the
  // range check is evaluated against the row's *current* period, so repeated
  // replays can walk the date forward one interval at a time.
  return withIdempotency(request, organizationId, (rawBody) =>
    handleReschedule(rawBody, { id, organizationId, userId, livemode, request }),
  );
}

async function handleReschedule(
  rawBody: string,
  args: {
    id: string;
    organizationId: string;
    userId: string;
    livemode: boolean;
    request: Request;
  },
): Promise<Response> {
  const { id, organizationId, userId, livemode, request } = args;

  const body = parseJsonBody(rawBody);
  if (!body.ok) return body.response;
  const parsed = parseWith(schema, body.data);
  if (!parsed.ok) return parsed.response;

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
    ipAddress: clientIp(request),
  });

  return NextResponse.json({ success: true, nextChargeDate: requested });
}
