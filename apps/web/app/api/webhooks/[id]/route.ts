import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { webhooks } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { validateWebhookUrl } from "@/lib/url-safety";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { clientIp } from "../../_shared/client-ip";
import { readJsonBody, parseWith } from "../../_shared/http";
import { requireRole } from "../../_shared/roles";

const VALID_EVENTS = [
  "payment.confirmed",
  "payment.refunded",
  "refund.requested",
  "refund.approved",
  "refund.declined",
  "subscription.created",
  "subscription.charged",
  "subscription.past_due",
  "subscription.cancelled",
  "subscription.trial_started",
  "subscription.trial_ending",
  "subscription.trial_converted",
  "subscription.trial_cancelled",
  "invoice.issued",
  "invoice.email_sent",
  "invoice.email_failed",
  "coupon.redeemed",
  "system.relayer_balance_low",
  "system.keeper_balance_low",
  "system.keeper_failure_rate_high",
  "system.webhook_failure_rate_high",
  "system.unmatched_retry_queue_deep",
  "system.trial_conversion_failure_rate_high",
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
  const { organizationId, livemode } = ctx;

  const { id } = await params;

  // Explicit projection — `.select()` returned `secret`, the HMAC key that
  // authenticates every webhook Paylix sends. The list endpoint and the
  // PATCH response already excluded it; this one didn't.
  const [row] = await db
    .select({
      id: webhooks.id,
      organizationId: webhooks.organizationId,
      url: webhooks.url,
      events: webhooks.events,
      isActive: webhooks.isActive,
      createdAt: webhooks.createdAt,
      livemode: webhooks.livemode,
      // secret intentionally excluded.
    })
    .from(webhooks)
    .where(and(eq(webhooks.id, id), orgScope(webhooks, { organizationId, livemode })));

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
  const { organizationId, userId, livemode } = ctx;

  // Repointing an existing endpoint redirects the org's whole event stream.
  const role = await requireRole(ctx);
  if (!role.ok) return role.response;

  const { id } = await params;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsedBody = parseWith(updateWebhookSchema, body.data);
  if (!parsedBody.ok) return parsedBody.response;

  const data = parsedBody.data;

  if (data.url) {
    const urlError = await validateWebhookUrl(data.url);
    if (urlError) {
      return apiError("invalid_url", urlError);
    }
  }

  const [updated] = await db
    .update(webhooks)
    .set(data)
    .where(and(eq(webhooks.id, id), orgScope(webhooks, { organizationId, livemode })))
    .returning({
      id: webhooks.id,
      organizationId: webhooks.organizationId,
      url: webhooks.url,
      events: webhooks.events,
      isActive: webhooks.isActive,
      createdAt: webhooks.createdAt,
      livemode: webhooks.livemode,
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
    ipAddress: clientIp(request),
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  const role = await requireRole(ctx);
  if (!role.ok) return role.response;

  const { id } = await params;

  const [deleted] = await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, id), orgScope(webhooks, { organizationId, livemode })))
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
    ipAddress: clientIp(request),
  });

  return NextResponse.json({ success: true });
}
