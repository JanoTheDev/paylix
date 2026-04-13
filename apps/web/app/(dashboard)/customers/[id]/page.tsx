import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import {
  customers,
  invoices,
  payments,
  products,
  subscriptions,
} from "@paylix/db/schema";
import { db } from "@/lib/db";
import { getActiveOrgOrRedirect } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";
import CustomerDetailView from "./customer-detail-view";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId, livemode } = await getActiveOrgOrRedirect();
  const { id } = await params;

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), orgScope(customers, { organizationId, livemode })))
    .limit(1);

  if (!customer) notFound();

  const [customerPayments, customerSubscriptions, customerInvoices] =
    await Promise.all([
      db
        .select({
          id: payments.id,
          amount: payments.amount,
          fee: payments.fee,
          status: payments.status,
          txHash: payments.txHash,
          createdAt: payments.createdAt,
          productName: products.name,
        })
        .from(payments)
        .leftJoin(products, eq(payments.productId, products.id))
        .where(and(eq(payments.customerId, id), orgScope(payments, { organizationId, livemode })))
        .orderBy(desc(payments.createdAt)),
      db
        .select({
          id: subscriptions.id,
          status: subscriptions.status,
          createdAt: subscriptions.createdAt,
          nextChargeDate: subscriptions.nextChargeDate,
          trialEndsAt: subscriptions.trialEndsAt,
          productName: products.name,
          metadata: subscriptions.metadata,
          pausedBy: subscriptions.pausedBy,
        })
        .from(subscriptions)
        .leftJoin(products, eq(subscriptions.productId, products.id))
        .where(
          and(
            eq(subscriptions.customerId, id),
            orgScope(subscriptions, { organizationId, livemode }),
          ),
        )
        .orderBy(desc(subscriptions.createdAt)),
      db
        .select({
          id: invoices.id,
          number: invoices.number,
          totalCents: invoices.totalCents,
          currency: invoices.currency,
          issuedAt: invoices.issuedAt,
          emailStatus: invoices.emailStatus,
          hostedToken: invoices.hostedToken,
        })
        .from(invoices)
        .where(
          and(eq(invoices.customerId, id), orgScope(invoices, { organizationId, livemode })),
        )
        .orderBy(desc(invoices.issuedAt)),
    ]);

  const name =
    customer.firstName || customer.lastName
      ? [customer.firstName, customer.lastName].filter(Boolean).join(" ")
      : null;

  const metadata = (customer.metadata as Record<string, string> | null) ?? {};

  return (
    <CustomerDetailView
      customer={{
        id: customer.id,
        name,
        email: customer.email,
        phone: customer.phone,
        walletAddress: customer.walletAddress,
        country: customer.country,
        taxId: customer.taxId,
        source: customer.source,
      }}
      metadata={metadata}
      payments={customerPayments}
      subscriptions={customerSubscriptions.map((s) => ({
        id: s.id,
        status: s.status,
        createdAt: s.createdAt,
        nextChargeDate: s.nextChargeDate,
        trialEndsAt: s.trialEndsAt,
        productName: s.productName,
        metadata: (s.metadata as Record<string, string> | null) ?? {},
        pausedBy: s.pausedBy,
      }))}
      invoices={customerInvoices.map((i) => ({
        id: i.id,
        number: i.number,
        totalCents: i.totalCents,
        currency: i.currency,
        issuedAt: i.issuedAt,
        emailStatus: i.emailStatus as
          | "pending"
          | "sent"
          | "failed"
          | "skipped",
        hostedToken: i.hostedToken,
      }))}
    />
  );
}
