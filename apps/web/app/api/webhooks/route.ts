import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { webhooks } from "@paylix/db/schema";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "crypto";
import { validateWebhookUrl } from "@/lib/url-safety";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { withIdempotency } from "@/lib/idempotency";
import { clientIp } from "../_shared/client-ip";
import { parseJsonBody, parseWith } from "../_shared/http";
import { requireRole } from "../_shared/roles";

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

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(VALID_EVENTS)).min(1),
});

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const rows = await db
    .select({
      id: webhooks.id,
      organizationId: webhooks.organizationId,
      url: webhooks.url,
      events: webhooks.events,
      isActive: webhooks.isActive,
      createdAt: webhooks.createdAt,
      livemode: webhooks.livemode,
      // secret intentionally excluded — only returned once on creation.
    })
    .from(webhooks)
    .where(orgScope(webhooks, { organizationId, livemode }))
    .orderBy(desc(webhooks.createdAt));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  // Registering an endpoint means receiving every payment event for the org
  // — customer emails, amounts, wallet addresses. Same blast radius as
  // minting an API key, so the same gate.
  const role = await requireRole(ctx);
  if (!role.ok) return role.response;

  return withIdempotency(request, organizationId, async (rawBody) => {
    const body = parseJsonBody(rawBody);
    if (!body.ok) return body.response;
    const parsed = parseWith(createWebhookSchema, body.data);
    if (!parsed.ok) return parsed.response;

    const { url, events } = parsed.data;

    const urlError = await validateWebhookUrl(url);
    if (urlError) {
      return apiError("invalid_url", urlError);
    }

    // NOTE: Generating a fresh secret here means that under the concurrent-miss
    // race documented in withIdempotency, two simultaneous requests with the
    // same Idempotency-Key would produce different secrets — one row survives
    // via onConflictDoNothing and the other caller would keep a dead secret
    // that fails every HMAC check. In practice this requires a client that
    // retries a creation POST while the first is still in flight, which is
    // vanishingly rare for dashboard-driven webhook creation. Revisit when the
    // two-phase insert is added to the idempotency helper.
    const secret = `whsec_${randomBytes(32).toString("hex")}`;

    const [row] = await db
      .insert(webhooks)
      .values({
        organizationId,
        livemode,
        url,
        secret,
        events,
      })
      .returning();

    void recordAudit({
      organizationId,
      userId,
      action: "webhook.created",
      resourceType: "webhook",
      resourceId: row.id,
      details: { url: row.url, events: row.events },
      ipAddress: clientIp(request),
    });

    return NextResponse.json(row, { status: 201 });
  });
}
