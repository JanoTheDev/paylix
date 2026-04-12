import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { webhooks } from "@paylix/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "crypto";
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

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(VALID_EVENTS)).min(1),
});

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId } = ctx;

  const rows = await db
    .select({
      id: webhooks.id,
      organizationId: webhooks.organizationId,
      url: webhooks.url,
      events: webhooks.events,
      isActive: webhooks.isActive,
      createdAt: webhooks.createdAt,
      // secret intentionally excluded — only returned once on creation.
    })
    .from(webhooks)
    .where(eq(webhooks.organizationId, organizationId))
    .orderBy(desc(webhooks.createdAt));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId } = ctx;

  const body = await request.json();
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

  const secret = `whsec_${randomBytes(32).toString("hex")}`;

  const [row] = await db
    .insert(webhooks)
    .values({
      organizationId,
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
}
