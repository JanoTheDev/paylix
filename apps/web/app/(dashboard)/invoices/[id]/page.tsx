import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoices, invoiceLineItems } from "@paylix/db/schema";
import { HostedInvoice } from "@/components/invoice/hosted-invoice";
import { PageShell, PageHeader } from "@/components/paykit";
import { getActiveOrgOrRedirect } from "@/lib/require-active-org";
import { orgScope } from "@/lib/org-scope";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const { organizationId, livemode } = await getActiveOrgOrRedirect();
  const { id } = await params;

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), orgScope(invoices, { organizationId, livemode })))
    .limit(1);
  if (!invoice) notFound();

  const lineItems = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoice.id));

  return (
    <PageShell>
      <PageHeader title={`Invoice ${invoice.number}`} />
      <HostedInvoice
        invoice={invoice}
        lineItems={lineItems}
        downloadHref={`/i/${invoice.hostedToken}/pdf`}
        receiptHref={`/i/${invoice.hostedToken}/receipt`}
      />
    </PageShell>
  );
}
