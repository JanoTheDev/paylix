import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { webhookDeliveries, webhooks } from "@paylix/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId } = ctx;

  const { id } = await params;

  const [hook] = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.organizationId, organizationId)));

  if (!hook) {
    return NextResponse.json({ error: { code: "not_found", message: "Webhook not found" } }, { status: 404 });
  }

  const rows = await db
    .select({
      id: webhookDeliveries.id,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      httpStatus: webhookDeliveries.httpStatus,
      attempts: webhookDeliveries.attempts,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, id))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(50);

  return NextResponse.json({ deliveries: rows });
}
