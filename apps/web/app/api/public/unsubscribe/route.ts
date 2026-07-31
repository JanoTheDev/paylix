import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  customerNotificationPreferences,
  type CustomerNotificationCategory,
} from "@paylix/db/schema";
import { verifyUnsubscribeToken } from "@/lib/portal-tokens";

const ALLOWED: CustomerNotificationCategory[] = [
  "marketing",
  "trial_reminders",
  "abandonment",
  "receipts",
];

/**
 * Token verification lives in `lib/portal-tokens.ts`.
 *
 * The local copy this replaced resolved its HMAC key with
 * `?? ""` — on any deployment without `PORTAL_TOKEN_SECRET`/
 * `BETTER_AUTH_SECRET` set, every unsubscribe token was signed with the
 * empty string and therefore forgeable for any customer id. The shared
 * helper throws on a missing or too-short secret instead of degrading.
 */
function verify(token: string): {
  customerId: string;
  category: CustomerNotificationCategory;
} | null {
  const result = verifyUnsubscribeToken(token, ALLOWED);
  if (!result) return null;
  // The helper already rejected anything outside ALLOWED.
  return {
    customerId: result.customerId,
    category: result.category as CustomerNotificationCategory,
  };
}

async function flip(
  customerId: string,
  category: CustomerNotificationCategory,
  optedIn: boolean,
) {
  await db
    .insert(customerNotificationPreferences)
    .values({ customerId, category, optedIn })
    .onConflictDoUpdate({
      target: [
        customerNotificationPreferences.customerId,
        customerNotificationPreferences.category,
      ],
      set: { optedIn, updatedAt: new Date() },
    });
}

/**
 * One-click unsubscribe landing page. Expects ?token=<customerId>.<category>.<hmac>.
 * GET flips opted_in = false and renders a small confirmation page with
 * a "resubscribe" button that POSTs back to the same token.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 400 });
  const parsed = verify(token);
  if (!parsed) return new Response("Invalid token", { status: 400 });

  await flip(parsed.customerId, parsed.category, false);

  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribed</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:24px;color:#0b0b0f}
h1{font-size:18px}p{color:#6b7280;font-size:14px;line-height:1.6}
button{background:#06d6a0;color:#07070a;border:0;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
</style></head><body>
<h1>You've been unsubscribed</h1>
<p>You won't receive <strong>${parsed.category.replace("_", " ")}</strong> emails from this merchant anymore.</p>
<form method="POST" action="/api/public/unsubscribe?token=${encodeURIComponent(token)}"><button type="submit">Undo — resubscribe me</button></form>
</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/** POST with the same token flips back to opted_in = true. */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  const parsed = verify(token);
  if (!parsed) return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  await flip(parsed.customerId, parsed.category, true);
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Resubscribed</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:24px;color:#0b0b0f}
h1{font-size:18px}p{color:#6b7280;font-size:14px;line-height:1.6}
</style></head><body>
<h1>You're resubscribed</h1>
<p>You'll continue to receive <strong>${parsed.category.replace("_", " ")}</strong> emails from this merchant.</p>
</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
