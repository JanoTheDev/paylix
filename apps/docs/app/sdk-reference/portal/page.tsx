import type { Metadata } from "next";
import {
  CodeBlock,
  DocTable,
  DocTableBody,
  DocTableHead,
  DocTableHeader,
  DocTableRow,
  PageHeading,
  ParamRow,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Customer Portal & Invoices — SDK Reference" };

export default function PortalReference() {
  return (
    <>
      <PageHeading
        title="Customer Portal & Invoices"
        description="Access customer data, create portal sessions, and list invoices."
      />

      <SectionHeading>paylix.getCustomerPortal()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Retrieves a customer&apos;s payment history and subscription details.
      </p>
      <CodeBlock language="ts">{`paylix.getCustomerPortal(params: { customerId: string }): Promise<CustomerPortalResult>`}</CodeBlock>

      <SubsectionHeading>Returns</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Field</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="customer" type="Customer" description="Customer profile object." />
          <ParamRow name="payments" type="Payment[]" description="Array of all payments by this customer." />
          <ParamRow name="subscriptions" type="Subscription[]" description="Array of active and past subscriptions." />
        </DocTableBody>
      </DocTable>

      <CodeBlock language="ts">{`const portal = await paylix.getCustomerPortal({
  customerId: "cust_xyz",
});

console.log("Payments:", portal.payments.length);
console.log("Active subs:", portal.subscriptions.filter(s => s.status === "active").length);`}</CodeBlock>

      <SectionHeading>paylix.createPortalSession()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Creates a signed, time-limited URL to the hosted customer portal.
        Redirect the customer to this URL so they can view their payments,
        subscriptions, and invoices, and cancel subscriptions — without
        needing a Paylix account.
      </p>
      <CodeBlock language="ts">{`paylix.createPortalSession(params: { customerId: string }): Promise<{ url: string }>`}</CodeBlock>
      <CodeBlock language="ts">{`const { url } = await paylix.createPortalSession({
  customerId: "cust_xyz",
});

// Redirect your user:
res.redirect(url);`}</CodeBlock>

      <SectionHeading>paylix.listCustomerInvoices()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Lists all invoices issued to a customer. Each entry includes
        public URLs for the hosted invoice page, the on-demand invoice
        PDF, and the on-demand payment receipt PDF — you can pass these
        URLs directly to your customer or surface them in your own UI.
      </p>
      <CodeBlock language="ts">{`paylix.listCustomerInvoices(params: { customerId: string }): Promise<{ invoices: CustomerInvoice[] }>`}</CodeBlock>

      <SubsectionHeading>CustomerInvoice</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Field</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="id" type="string" description="Invoice ID." />
          <ParamRow name="number" type="string" description={`Merchant-formatted invoice number (e.g. "INV-000042").`} />
          <ParamRow name="totalCents" type="number" description="Grand total in integer cents (1000 = 10.00 USDC)." />
          <ParamRow name="subtotalCents" type="number" description="Pre-tax subtotal in integer cents." />
          <ParamRow name="taxCents" type="number" description="Tax portion in integer cents (0 if reverse-charge or untaxed)." />
          <ParamRow name="taxLabel" type="string | null" description={`Label shown next to the tax line (e.g. "VAT 20%").`} />
          <ParamRow name="currency" type="string" description={`Currency code ("USDC").`} />
          <ParamRow name="issuedAt" type="string" description="ISO-8601 timestamp of issue." />
          <ParamRow name="emailStatus" type={`"pending" | "sent" | "failed" | "skipped"`} description="Delivery state of the invoice email." />
          <ParamRow name="hostedUrl" type="string" description="Public HTML page the customer can bookmark." />
          <ParamRow name="invoicePdfUrl" type="string" description="On-demand invoice PDF download link." />
          <ParamRow name="receiptPdfUrl" type="string" description="On-demand payment receipt PDF download link." />
        </DocTableBody>
      </DocTable>

      <CodeBlock language="ts">{`const { invoices } = await paylix.listCustomerInvoices({
  customerId: "cust_xyz",
});

for (const invoice of invoices) {
  console.log(invoice.number, "-", invoice.totalCents / 100, invoice.currency);
  console.log("  Hosted:", invoice.hostedUrl);
  console.log("  Invoice PDF:", invoice.invoicePdfUrl);
  console.log("  Receipt PDF:", invoice.receiptPdfUrl);
}`}</CodeBlock>
    </>
  );
}
