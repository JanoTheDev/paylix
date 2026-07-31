import { db } from "@/lib/db";
import { webhooks, webhookDeliveries } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";
import { createHmac } from "crypto";
import { validateWebhookUrl } from "@/lib/url-safety";

const DELIVERY_TIMEOUT_MS = 10_000;
const USER_AGENT = "Paylix-Webhook/1.0";

export interface WebhookEnvelope {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export function buildEnvelope(
  event: string,
  data: Record<string, unknown>,
): WebhookEnvelope {
  return { event, timestamp: new Date().toISOString(), data };
}

/**
 * `t=<unix-seconds>,v1=<hmac-sha256>` over `<ts>.<body>`. The timestamp ties
 * the signature to a moment in time so receivers can reject replays outside
 * their tolerance window (default 5 min in the SDK verifier).
 */
export function signWebhookPayload(
  secret: string,
  payload: string,
  tsSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const mac = createHmac("sha256", secret)
    .update(`${tsSeconds}.${payload}`)
    .digest("hex");
  return `t=${tsSeconds},v1=${mac}`;
}

export type DeliveryOutcome =
  | { ok: true; httpStatus: number }
  | { ok: false; httpStatus: number | null; error: string };

/**
 * Single implementation of "sign, record, POST, mark the row".
 *
 * Every caller (dispatch loop, send-test, replay) must go through this so an
 * SSRF or signature fix lands once instead of four times.
 *
 * SSRF controls:
 *  - the URL is re-validated immediately before the request, because DNS can
 *    be re-pointed at an internal address after registration (rebinding);
 *  - `redirect: "manual"` means a 3xx is recorded as a failed delivery
 *    instead of silently issuing a second, unvalidated request to whatever
 *    the merchant's endpoint points at (e.g. 169.254.169.254).
 */
export async function deliverWebhook(args: {
  webhook: { id: string; url: string; secret: string; livemode?: boolean };
  event: string;
  envelope: WebhookEnvelope;
  /** Existing delivery row to update; a new `pending` row is created when omitted. */
  deliveryId?: string;
  /** Attempt number to record. Defaults to 1. */
  attempt?: number;
}): Promise<DeliveryOutcome & { deliveryId: string }> {
  const { webhook, event, envelope } = args;
  const payload = JSON.stringify(envelope);
  const signature = signWebhookPayload(webhook.secret, payload);
  const attempts = args.attempt ?? 1;

  let deliveryId = args.deliveryId;
  if (!deliveryId) {
    const [row] = await db
      .insert(webhookDeliveries)
      .values({
        webhookId: webhook.id,
        event,
        payload: envelope,
        status: "pending",
        attempts: 0,
        livemode: webhook.livemode ?? false,
      })
      .returning({ id: webhookDeliveries.id });
    deliveryId = row.id;
  }

  const fail = async (error: string, httpStatus: number | null) => {
    await db
      .update(webhookDeliveries)
      .set({
        status: "failed",
        httpStatus: httpStatus ?? null,
        attempts,
      })
      .where(eq(webhookDeliveries.id, deliveryId!));
    return { ok: false as const, httpStatus, error, deliveryId: deliveryId! };
  };

  // Re-validate at send time, not just at registration time.
  const urlError = await validateWebhookUrl(webhook.url);
  if (urlError) return fail(`blocked_url: ${urlError}`, null);

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paylix-signature": signature,
        "User-Agent": USER_AGENT,
      },
      body: payload,
      redirect: "manual",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    // `redirect: "manual"` surfaces 3xx here rather than following it.
    if (response.status >= 300 && response.status < 400) {
      return fail("redirect_not_followed", response.status);
    }
    if (!response.ok) {
      return fail(`http_${response.status}`, response.status);
    }

    await db
      .update(webhookDeliveries)
      .set({ status: "delivered", httpStatus: response.status, attempts })
      .where(eq(webhookDeliveries.id, deliveryId));

    return { ok: true, httpStatus: response.status, deliveryId };
  } catch {
    // Never surface the raw error: it can contain the merchant's URL and any
    // resolved internal host, which is exactly what an SSRF prober wants.
    return fail("request_failed", null);
  }
}

/**
 * Fan an event out to an organization's active webhooks.
 *
 * `livemode` scopes delivery to endpoints registered in the same mode. It is
 * optional only so the existing call sites keep compiling — pass it
 * everywhere; without it a test-mode event is delivered to live endpoints.
 */
export async function dispatchWebhooks(
  organizationId: string,
  event: string,
  data: Record<string, unknown>,
  livemode?: boolean,
): Promise<void> {
  try {
    if (!organizationId) return;

    const filters = [
      eq(webhooks.organizationId, organizationId),
      eq(webhooks.isActive, true),
    ];
    if (livemode !== undefined) {
      filters.push(eq(webhooks.livemode, livemode));
    }

    const orgWebhooks = await db
      .select({
        id: webhooks.id,
        url: webhooks.url,
        secret: webhooks.secret,
        events: webhooks.events,
        livemode: webhooks.livemode,
      })
      .from(webhooks)
      .where(and(...filters));

    const matching = orgWebhooks.filter((wh) => wh.events.includes(event));
    if (matching.length === 0) return;

    const envelope = buildEnvelope(event, data);

    for (const wh of matching) {
      await deliverWebhook({ webhook: wh, event, envelope });
    }
  } catch (err) {
    console.error(
      "[webhook-dispatch] dispatchWebhooks failed:",
      err instanceof Error ? err.message : "unknown error",
    );
  }
}
