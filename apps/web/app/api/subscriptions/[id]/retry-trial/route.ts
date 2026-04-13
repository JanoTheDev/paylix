import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const { id } = await params;

  const [row] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, id),
        orgScope(subscriptions, { organizationId, livemode }),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { error: { code: "not_found" } },
      { status: 404 },
    );
  }

  if (row.status !== "trial_conversion_failed") {
    return NextResponse.json(
      {
        error: {
          code: "not_failed_trial",
          message:
            "Only trial_conversion_failed subscriptions can be retried.",
        },
      },
      { status: 409 },
    );
  }

  if (!row.pendingPermitSignature) {
    return NextResponse.json(
      {
        error: {
          code: "missing_signature",
          message:
            "Pending permit signature has been cleared; customer must re-checkout.",
        },
      },
      { status: 409 },
    );
  }

  await db
    .update(subscriptions)
    .set({
      status: "trialing",
      trialConversionAttempts: 0,
      trialConversionLastError: null,
      trialEndsAt: new Date(),
    })
    .where(eq(subscriptions.id, id));

  void recordAudit({
    organizationId,
    userId,
    action: "subscription.trial_retried",
    resourceType: "subscription",
    resourceId: id,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true });
}
