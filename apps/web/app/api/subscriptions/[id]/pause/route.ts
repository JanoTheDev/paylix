import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { computePauseUpdate } from "./logic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;
  const { id } = await params;

  const [existing] = await db
    .select({ status: subscriptions.status, pausedBy: subscriptions.pausedBy })
    .from(subscriptions)
    .where(and(eq(subscriptions.id, id), orgScope(subscriptions, { organizationId, livemode })));

  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Subscription not found" } }, { status: 404 });
  }

  const result = computePauseUpdate(existing, "merchant", new Date());
  if (!result.ok) {
    return NextResponse.json({ error: { code: "invalid_state", message: result.reason } }, { status: 409 });
  }

  await db.update(subscriptions).set(result.update).where(eq(subscriptions.id, id));

  void recordAudit({
    organizationId,
    userId,
    action: "subscription.paused",
    resourceType: "subscription",
    resourceId: id,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json({ success: true });
}
