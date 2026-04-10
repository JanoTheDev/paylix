import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { webhooks } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const VALID_EVENTS = [
  "payment.confirmed",
  "subscription.created",
  "subscription.charged",
  "subscription.past_due",
  "subscription.cancelled",
] as const;

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(VALID_EVENTS)).min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = updateWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  const [updated] = await db
    .update(webhooks)
    .set(data)
    .where(and(eq(webhooks.id, id), eq(webhooks.userId, session.user.id)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [deleted] = await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.userId, session.user.id)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
