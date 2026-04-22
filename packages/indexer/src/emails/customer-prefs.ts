import { createHmac, timingSafeEqual } from "crypto";
import { and, eq } from "drizzle-orm";
import { createDb } from "@paylix/db/client";
import {
  customerNotificationPreferences,
  type CustomerNotificationCategory,
} from "@paylix/db/schema";
import { config } from "../config";

const db = createDb(config.databaseUrl);

/**
 * Returns whether a customer should receive a given category of email.
 * No row for (customer, category) = opted in (default). opted_in=false
 * suppresses. Callers already check merchant-level notification toggles
 * first; this is the finer per-customer layer.
 */
export async function customerOptedIn(
  customerId: string,
  category: CustomerNotificationCategory,
): Promise<boolean> {
  const [row] = await db
    .select({ optedIn: customerNotificationPreferences.optedIn })
    .from(customerNotificationPreferences)
    .where(
      and(
        eq(customerNotificationPreferences.customerId, customerId),
        eq(customerNotificationPreferences.category, category),
      ),
    )
    .limit(1);
  if (!row) return true;
  return row.optedIn;
}

/**
 * Sign a one-click unsubscribe token. HMAC over customerId.category.
 * No expiry — unsubscribe links should keep working indefinitely since
 * receivers often revisit old emails.
 */
export function signUnsubscribeToken(
  customerId: string,
  category: CustomerNotificationCategory,
  secret: string,
): string {
  const payload = `${customerId}.${category}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): { customerId: string; category: CustomerNotificationCategory } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [customerId, category, provided] = parts;
  const allowed: CustomerNotificationCategory[] = [
    "marketing",
    "trial_reminders",
    "abandonment",
    "receipts",
  ];
  if (!allowed.includes(category as CustomerNotificationCategory)) return null;
  const expected = createHmac("sha256", secret)
    .update(`${customerId}.${category}`)
    .digest("hex");
  if (expected.length !== provided.length) return null;
  try {
    const ok = timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(provided, "hex"),
    );
    if (!ok) return null;
  } catch {
    return null;
  }
  return { customerId, category: category as CustomerNotificationCategory };
}
