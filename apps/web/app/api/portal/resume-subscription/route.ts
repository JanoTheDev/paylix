import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { verifyPortalToken } from "@/lib/portal-tokens";
import { computeResumeUpdate } from "../../subscriptions/[id]/pause/logic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { subscriptionId, customerId, token } = body as {
    subscriptionId?: string;
    customerId?: string;
    token?: string;
  };

  if (!subscriptionId || !customerId || !token) {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "Missing subscriptionId, customerId, or token" } },
      { status: 400 },
    );
  }

  if (!verifyPortalToken(token, customerId)) {
    return NextResponse.json(
      { error: { code: "invalid_token", message: "Invalid or expired portal token" } },
      { status: 401 },
    );
  }

  const [sub] = await db
    .select({
      status: subscriptions.status,
      customerId: subscriptions.customerId,
      pausedAt: subscriptions.pausedAt,
      pausedBy: subscriptions.pausedBy,
      nextChargeDate: subscriptions.nextChargeDate,
    })
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);

  if (!sub) {
    return NextResponse.json({ error: { code: "not_found", message: "Subscription not found" } }, { status: 404 });
  }

  if (sub.customerId !== customerId) {
    return NextResponse.json({ error: { code: "forbidden", message: "Not your subscription" } }, { status: 403 });
  }

  const result = computeResumeUpdate(sub, "customer", new Date());
  if (!result.ok) {
    if (result.code === "paused_by_other_party") {
      return NextResponse.json({ error: { code: "paused_by_other_party", message: result.reason } }, { status: 403 });
    }
    return NextResponse.json({ error: { code: "invalid_state", message: result.reason } }, { status: 409 });
  }

  await db.update(subscriptions).set(result.update).where(eq(subscriptions.id, subscriptionId));

  return NextResponse.json({ success: true });
}
