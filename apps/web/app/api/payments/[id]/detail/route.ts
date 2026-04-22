import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payments,
  refunds,
  invoices,
  customers,
  products,
  checkoutSessions,
  webhookDeliveries,
} from "@paylix/db/schema";
import { resolveActiveOrg } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import { apiError } from "@/lib/api-error";

/**
 * Dashboard-only composite view for a single payment. Returns the
 * payment row, its refunds, linked invoice + checkout session, and
 * related webhook deliveries (filtered to payment.* / invoice.* /
 * subscription.charged event types). Separate from the SDK GET at
 * /api/payments/:id which returns the verification shape.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId, livemode } = ctx;

  const { id } = await params;

  const [payment] = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      fee: payments.fee,
      status: payments.status,
      txHash: payments.txHash,
      chain: payments.chain,
      token: payments.token,
      fromAddress: payments.fromAddress,
      toAddress: payments.toAddress,
      blockNumber: payments.blockNumber,
      metadata: payments.metadata,
      refundedCents: payments.refundedCents,
      refundedAt: payments.refundedAt,
      quantity: payments.quantity,
      createdAt: payments.createdAt,
      productId: payments.productId,
      productName: products.name,
      productType: products.type,
      customerUuid: customers.id,
      customerExternalId: customers.customerId,
      customerEmail: customers.email,
      customerWallet: customers.walletAddress,
      invoiceId: invoices.id,
      invoiceNumber: invoices.number,
      invoiceHostedToken: invoices.hostedToken,
    })
    .from(payments)
    .leftJoin(products, eq(products.id, payments.productId))
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .leftJoin(invoices, eq(invoices.paymentId, payments.id))
    .where(
      and(eq(payments.id, id), orgScope(payments, { organizationId, livemode })),
    )
    .limit(1);

  if (!payment) return apiError("not_found", "Payment not found", 404);

  const [refundRows, linkedSession, relatedDeliveries] = await Promise.all([
    db
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, id))
      .orderBy(desc(refunds.createdAt)),
    db
      .select({ id: checkoutSessions.id, status: checkoutSessions.status })
      .from(checkoutSessions)
      .where(eq(checkoutSessions.paymentId, id))
      .limit(1),
    // Top 500 recent deliveries, then filter client-side to the event
    // types that could concern this payment. Good enough for orgs with
    // moderate webhook traffic; a dedicated payment-id index in the
    // webhook delivery payload is a follow-up optimisation.
    db
      .select({
        id: webhookDeliveries.id,
        event: webhookDeliveries.event,
        status: webhookDeliveries.status,
        httpStatus: webhookDeliveries.httpStatus,
        attempts: webhookDeliveries.attempts,
        createdAt: webhookDeliveries.createdAt,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.livemode, livemode))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(500),
  ]);

  const trimmedDeliveries = relatedDeliveries
    .filter(
      (d) =>
        d.event.startsWith("payment.") ||
        d.event.startsWith("invoice.") ||
        d.event === "subscription.charged",
    )
    .slice(0, 20);

  return NextResponse.json({
    payment: {
      ...payment,
      createdAt: payment.createdAt?.toISOString?.() ?? payment.createdAt,
      refundedAt: payment.refundedAt?.toISOString?.() ?? null,
    },
    refunds: refundRows.map((r) => ({
      ...r,
      createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
    })),
    webhookDeliveries: trimmedDeliveries.map((d) => ({
      ...d,
      createdAt: d.createdAt?.toISOString?.() ?? d.createdAt,
    })),
    checkoutSession: linkedSession[0] ?? null,
  });
}
