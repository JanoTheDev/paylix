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

  if (row.status !== "trialing" && row.status !== "trial_conversion_failed") {
    return NextResponse.json(
      {
        error: {
          code: "not_in_trial",
          message:
            "Only trialing or failed-trial subscriptions can be cancelled this way.",
        },
      },
      { status: 409 },
    );
  }

  await db
    .update(subscriptions)
    .set({ status: "cancelled", pendingPermitSignature: null })
    .where(eq(subscriptions.id, id));

  void recordAudit({
    organizationId,
    userId,
    action: "subscription.trial_cancelled",
    resourceType: "subscription",
    resourceId: id,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true });
}
