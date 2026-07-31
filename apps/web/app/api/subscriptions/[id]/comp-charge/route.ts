import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { subscriptions, payments } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { recordAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { clientIp } from "../../../_shared/client-ip";
import { requireRole } from "../../../_shared/roles";
import { withIdempotency } from "@/lib/idempotency";

/**
 * Admin-only: forgive the current past-due cycle. Inserts a payment row
 * with amount = 0 and metadata.comped = true, flips the subscription
 * back to active, and advances next_charge_date by one interval. No
 * USDC moves on-chain. Use this to keep a good customer who briefly
 * went past-due without charging them for the missed cycle.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, userId, livemode } = ctx;

  // Forgiving a cycle writes a zero-amount payment row and moves the billing
  // date — a revenue decision, not a member-level one.
  const role = await requireRole(ctx);
  if (!role.ok) return role.response;

  const { id } = await params;

  // Not idempotent on its own: a response lost to a gateway timeout that the
  // caller retries inserts a SECOND amount-0 payment row and advances
  // nextChargeDate by another interval — two free periods for one click.
  return withIdempotency(request, organizationId, () =>
    handleCompCharge({ id, organizationId, userId, livemode, request }),
  );
}

async function handleCompCharge(args: {
  id: string;
  organizationId: string;
  userId: string;
  livemode: boolean;
  request: Request;
}): Promise<Response> {
  const { id, organizationId, userId, livemode, request } = args;

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, id),
        orgScope(subscriptions, { organizationId, livemode }),
      ),
    )
    .limit(1);
  if (!sub) return apiError("not_found", "Subscription not found", 404);
  if (sub.status !== "past_due" && sub.status !== "active") {
    return apiError(
      "invalid_status",
      "Only active or past-due subs can have a charge comped",
      409,
    );
  }
  if (!sub.intervalSeconds) {
    return apiError("missing_interval", "Subscription has no interval", 409);
  }

  const now = new Date();
  const next = new Date(now.getTime() + sub.intervalSeconds * 1000);

  const [payment] = await db
    .insert(payments)
    .values({
      productId: sub.productId,
      organizationId,
      customerId: sub.customerId,
      amount: 0,
      fee: 0,
      status: "confirmed",
      txHash: null,
      chain: sub.networkKey,
      token: sub.tokenSymbol,
      fromAddress: sub.subscriberAddress,
      toAddress: null,
      blockNumber: null,
      metadata: { comped: "true", reason: "merchant_comped" },
      quantity: sub.quantity ?? 1,
      livemode,
    })
    .returning();

  await db
    .update(subscriptions)
    .set({
      status: "active",
      nextChargeDate: next,
      currentPeriodStart: now,
      currentPeriodEnd: next,
      lastPaymentId: payment.id,
      chargeFailureCount: 0,
      lastChargeError: null,
    })
    .where(eq(subscriptions.id, id));

  void recordAudit({
    organizationId,
    userId,
    action: "subscription.charge_comped",
    resourceType: "subscription",
    resourceId: id,
    details: { paymentId: payment.id },
    ipAddress: clientIp(request),
  });

  return NextResponse.json({
    success: true,
    paymentId: payment.id,
    nextChargeDate: next,
  });
}
