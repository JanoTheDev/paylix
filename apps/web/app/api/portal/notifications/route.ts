import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  CUSTOMER_NOTIFICATION_CATEGORIES,
  customerNotificationPreferences,
  type CustomerNotificationCategory,
} from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { verifyPortalToken } from "@/lib/portal-tokens";
import { apiError } from "@/lib/api-error";

const patchSchema = z.object({
  customerId: z.string().uuid(),
  token: z.string(),
  category: z.enum(["marketing", "trial_reminders", "abandonment", "receipts"]),
  optedIn: z.boolean(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const token = url.searchParams.get("token");
  if (!customerId || !token) {
    return apiError("invalid_body", "Missing customerId or token", 400);
  }
  if (!verifyPortalToken(token, customerId)) {
    return apiError("invalid_token", "Invalid or expired portal token", 401);
  }

  const rows = await db
    .select()
    .from(customerNotificationPreferences)
    .where(eq(customerNotificationPreferences.customerId, customerId));

  const byCat = new Map(rows.map((r) => [r.category, r.optedIn]));
  const prefs = CUSTOMER_NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    optedIn: byCat.get(category) ?? true,
  }));
  return NextResponse.json(prefs);
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      "validation_failed",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const { customerId, token, category, optedIn } = parsed.data;
  if (!verifyPortalToken(token, customerId)) {
    return apiError("invalid_token", "Invalid or expired portal token", 401);
  }

  const cat: CustomerNotificationCategory = category;

  const [existing] = await db
    .select()
    .from(customerNotificationPreferences)
    .where(
      and(
        eq(customerNotificationPreferences.customerId, customerId),
        eq(customerNotificationPreferences.category, cat),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(customerNotificationPreferences)
      .set({ optedIn })
      .where(eq(customerNotificationPreferences.id, existing.id));
  } else {
    await db
      .insert(customerNotificationPreferences)
      .values({ customerId, category: cat, optedIn });
  }

  return NextResponse.json({ success: true, category: cat, optedIn });
}
