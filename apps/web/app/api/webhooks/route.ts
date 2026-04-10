import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { webhooks } from "@paylix/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "crypto";

const VALID_EVENTS = [
  "payment.confirmed",
  "subscription.created",
  "subscription.charged",
  "subscription.past_due",
  "subscription.cancelled",
] as const;

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(VALID_EVENTS)).min(1),
});

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.userId, session.user.id))
    .orderBy(desc(webhooks.createdAt));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { url, events } = parsed.data;
  const secret = `whsec_${randomBytes(32).toString("hex")}`;

  const [row] = await db
    .insert(webhooks)
    .values({
      userId: session.user.id,
      url,
      secret,
      events,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
