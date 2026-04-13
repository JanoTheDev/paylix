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

  return withIdempotency(request, organizationId, async (rawBody) => {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiError("invalid_body", "Request body must be valid JSON.", 400);
    }
    const parsed = createWebhookSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join("; ");
      return apiError("validation_failed", issues);
    }

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
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

    return NextResponse.json(row, { status: 201 });
  });
}
