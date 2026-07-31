import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  CUSTOMER_NOTIFICATION_CATEGORIES,
  customerNotificationPreferences,
  type CustomerNotificationCategory,
} from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requirePortalCustomer } from "@/lib/portal-auth";
import { apiError } from "@/lib/api-error";

const patchSchema = z.object({
  customerId: z.string().uuid(),
  token: z.string(),
  category: z.enum(["marketing", "trial_reminders", "abandonment", "receipts"]),
  optedIn: z.boolean(),
});

export async function GET(request: Request) {
  const portal = await requirePortalCustomer(request);
  if (!portal.ok) return portal.response;
  const customerId = portal.customerId;

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
  const portal = await requirePortalCustomer(request, parsed.data);
  if (!portal.ok) return portal.response;
  const customerId = portal.customerId;
  const { category, optedIn } = parsed.data;

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
