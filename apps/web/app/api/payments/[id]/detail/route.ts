import { NextResponse } from "next/server";
import { and, desc, eq, like, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payments,
  refunds,
  invoices,
  customers,
  products,
  checkoutSessions,
  webhookDeliveries,
  webhooks,
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
    // `webhook_deliveries` has no organization_id of its own — ownership
    // comes from the webhook it belongs to, so the scope has to be an
    // innerJoin. Without it this query took the top 500 deliveries
    // PLATFORM-WIDE and leaked other organizations' delivery ids, event
    // names and HTTP statuses into every merchant's payment-detail pane.
    //
    // The event-type filter is also in SQL now, so the limit applies to rows
    // that can actually concern this payment rather than being eaten by
    // unrelated traffic before the JS slice.
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
      .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
      .where(
        and(
          orgScope(webhooks, { organizationId, livemode }),
          eq(webhookDeliveries.livemode, livemode),
          or(
            like(webhookDeliveries.event, "payment.%"),
            like(webhookDeliveries.event, "invoice.%"),
            eq(webhookDeliveries.event, "subscription.charged"),
          ),
        ),
      )
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(20),
  ]);

  const trimmedDeliveries = relatedDeliveries;

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
