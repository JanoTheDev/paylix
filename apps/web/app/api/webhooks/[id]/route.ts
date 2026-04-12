import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { webhooks } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { validateWebhookUrl } from "@/lib/url-safety";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";

const VALID_EVENTS = [
  "payment.confirmed",
  "subscription.created",
  "subscription.charged",
  "subscription.past_due",
  "subscription.cancelled",
  "invoice.issued",
  "invoice.email_sent",
  "invoice.email_failed",
] as const;

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(VALID_EVENTS)).min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId } = ctx;

  const { id } = await params;

  const [row] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.organizationId, organizationId)));

  if (!row) {
    return apiError("not_found", "Not found", 404);
  }

  return NextResponse.json(row);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId } = ctx;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateWebhookSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join("; ");
    return apiError("validation_failed", issues);
  }

  const data = parsed.data;

  if (data.url) {
    const urlError = await validateWebhookUrl(data.url);
    if (urlError) {
      return apiError("invalid_url", urlError);
    }
  }

  const [updated] = await db
    .update(webhooks)
    .set(data)
    .where(and(eq(webhooks.id, id), eq(webhooks.organizationId, organizationId)))
    .returning({
      id: webhooks.id,
      organizationId: webhooks.organizationId,
      url: webhooks.url,
      events: webhooks.events,
      isActive: webhooks.isActive,
      createdAt: webhooks.createdAt,
      // secret intentionally excluded.
    });

  if (!updated) {
    return apiError("not_found", "Not found", 404);
  }

  void recordAudit({
    organizationId,
    userId,
    action: "webhook.updated",
    resourceType: "webhook",
    resourceId: id,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId } = ctx;

  const { id } = await params;

  const [deleted] = await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.organizationId, organizationId)))
    .returning();

  if (!deleted) {
    return apiError("not_found", "Not found", 404);
  }

  void recordAudit({
    organizationId,
    userId,
    action: "webhook.deleted",
    resourceType: "webhook",
    resourceId: id,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  return NextResponse.json({ success: true });
}
