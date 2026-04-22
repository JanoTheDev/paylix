import { db } from "@/lib/db";
import { webhooks, webhookDeliveries } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";
import { createHmac } from "crypto";

export async function dispatchWebhooks(
  organizationId: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    if (!organizationId) return;

    const orgWebhooks = await db
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.organizationId, organizationId),
          eq(webhooks.isActive, true),
        ),
      );

    const matching = orgWebhooks.filter((wh) => wh.events.includes(event));

    const timestamp = new Date().toISOString();
    const eventPayload = { event, timestamp, data };
    const payload = JSON.stringify(eventPayload);
    // Unix seconds — the signature ties the request to a moment in time
    // so receivers can reject replays that arrive outside their tolerance
    // window (default 5 min in the SDK verifier).
    const ts = Math.floor(Date.now() / 1000);

    for (const wh of matching) {
      const signature = `t=${ts},v1=${createHmac("sha256", wh.secret)
        .update(`${ts}.${payload}`)
        .digest("hex")}`;

      const [delivery] = await db
        .insert(webhookDeliveries)
        .values({
          webhookId: wh.id,
          event,
          payload: eventPayload,
          status: "pending",
          attempts: 0,
        })
        .returning();

      try {
        const response = await fetch(wh.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-paylix-signature": signature,
            "User-Agent": "Paylix-Webhook/1.0",
          },
          body: payload,
          signal: AbortSignal.timeout(10_000),
        });

        await db
          .update(webhookDeliveries)
          .set({
            status: response.ok ? "delivered" : "failed",
            httpStatus: response.status,
            attempts: 1,
          })
          .where(eq(webhookDeliveries.id, delivery.id));
      } catch {
        await db
          .update(webhookDeliveries)
          .set({ status: "failed", attempts: 1 })
          .where(eq(webhookDeliveries.id, delivery.id));
      }
    }
  } catch (err) {
    console.error("[webhook-dispatch] dispatchWebhooks failed:", err);
  }
}
