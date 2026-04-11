import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Invoices" };

export default function Invoices() {
  return (
    <>
      <PageHeading
        title="Invoices"
        description="Paylix automatically issues a legally-valid invoice for every successful payment — one-time checkouts and every recurring subscription charge. Invoices are immutable, sequentially numbered per merchant, and accessible via hosted link, PDF download, email, dashboard, customer portal, and SDK."
      />

      <Callout variant="tip" title="Paylix is not a Merchant of Record">
        You are the legal seller of your products. Paylix gives you the tools
        to produce compliant invoices — sequential numbering, merchant-set
        tax rates, customer tax ID collection, reverse-charge support — but
        does not file or remit taxes on your behalf. Configure your tax rates
        in the product form before accepting payments.
      </Callout>

      <SectionHeading>How it works</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Every time the indexer confirms an on-chain payment, it creates an
        invoice row inside the <em>same database transaction</em> — so you
        get exactly-once semantics with no polling or reconciliation job.
        Immediately after commit, the mailer enqueues an email with a
        link-only body pointing at the hosted invoice page.
      </p>
      <ul className="mt-3 space-y-2 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          <strong className="text-foreground">Hosted page</strong> — public
          HTML at <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">/i/[token]</code>.
          The URL contains a 32-char unguessable token; the email itself is
          the auth boundary (same model as Stripe, Square, Wave).
        </li>
        <li>
          <strong className="text-foreground">Invoice PDF</strong> — regenerated
          on demand at <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">/i/[token]/pdf</code>.
          No storage, no stale PDFs, no Chromium.
        </li>
        <li>
          <strong className="text-foreground">Receipt PDF</strong> — a simpler
          one-page payment confirmation at <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">/i/[token]/receipt</code> including
          the on-chain transaction hash as verifiable proof of settlement.
        </li>
      </ul>

      <SectionHeading>Setting up your business profile</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Before your first payment, fill in your business profile under{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          Settings → Business Profile
        </code>
        . These fields are snapshotted onto every invoice at issue time —
        invoices are legally required to show what was true when they were
        issued, so changing your profile later does not affect past invoices.
      </p>
      <ul className="mt-3 space-y-2 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>Legal name, address, country, tax ID, support email</li>
        <li>Logo (PNG / JPG / SVG / WebP, max 512 KB)</li>
        <li>
          Invoice number prefix (default{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            INV-
          </code>
          ) — invoices render as <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">INV-000042</code>
        </li>
        <li>Optional footer (terms, support info, etc.)</li>
      </ul>

      <SectionHeading>Tax rates and reverse charge</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Taxes are configured per product. Set{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          taxRateBps
        </code>{" "}
        (basis points, 2000 = 20%), a display label (e.g. &quot;VAT 20%&quot;),
        and optionally mark the product as reverse-charge eligible.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-foreground-muted">
        To collect customer tax info at checkout, enable{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          collectCountry
        </code>{" "}
        and{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          collectTaxId
        </code>{" "}
        on the checkout session. When the product is reverse-charge eligible{" "}
        <em>and</em> the customer provides a tax ID <em>and</em> their country
        is in the EU, the invoice renders with{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          taxCents = 0
        </code>{" "}
        and a &quot;Reverse charge — recipient liable&quot; label. All other
        combinations apply the per-product rate.
      </p>

      <SectionHeading>Email delivery</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Paylix ships with a pluggable mailer driven by the{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          MAIL_DRIVER
        </code>{" "}
        environment variable. Two drivers are supported:
      </p>
      <CodeBlock language="bash">{`# Cloud-style (recommended for hosted deployments)
MAIL_DRIVER=resend
RESEND_API_KEY=re_xxxxx

# Self-host friendly (no external signup)
MAIL_DRIVER=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# Common
INVOICE_FROM_EMAIL=invoices@yourdomain.test
PUBLIC_APP_URL=https://paylix.example.com`}</CodeBlock>
      <p className="mt-3 text-sm leading-relaxed text-foreground-muted">
        If{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          MAIL_DRIVER
        </code>{" "}
        is unset in production, invoices are still created but marked{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          emailStatus=&quot;skipped&quot;
        </code>{" "}
        so nothing crashes — the merchant can re-send manually from the
        dashboard invoice detail page.
      </p>

      <SectionHeading>Accessing invoices</SectionHeading>

      <SubsectionHeading>Merchant dashboard</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Invoices are surfaced in two places in the dashboard. The{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          Payments
        </code>{" "}
        list shows a Download invoice action on every row. The customer
        detail page at{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          Customers → [customer]
        </code>{" "}
        has a dedicated Invoices section with download links for both the
        invoice PDF and the payment receipt, alongside that customer&apos;s
        payments and subscriptions. There is no standalone Invoices page —
        invoices live where the customer and payment context already is.
      </p>

      <SubsectionHeading>Customer portal</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Generate a signed portal URL via{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          paylix.createPortalSession({"{ customerId }"})
        </code>{" "}
        and redirect your user there. The portal shows their payments,
        active subscriptions, and all issued invoices with download links.
      </p>

      <SubsectionHeading>SDK</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Fetch invoices for a customer from your own backend — perfect for
        rendering a receipts section inside your product:
      </p>
      <CodeBlock language="ts">{`import { Paylix } from "@paylix/sdk";

const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  network: "base",
  backendUrl: process.env.PAYLIX_BACKEND_URL!,
});

// Signed portal URL (redirect your customer):
const { url } = await paylix.createPortalSession({
  customerId: "cust_xyz",
});

// Or list invoices directly and render your own UI:
const { invoices } = await paylix.listCustomerInvoices({
  customerId: "cust_xyz",
});

for (const inv of invoices) {
  // inv.hostedUrl      — public HTML page
  // inv.invoicePdfUrl  — on-demand invoice PDF
  // inv.receiptPdfUrl  — on-demand payment receipt PDF
  console.log(inv.number, \`$\${inv.totalCents / 100}\`, inv.receiptPdfUrl);
}`}</CodeBlock>

      <SectionHeading>Webhook events</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Three webhook events cover the full invoice lifecycle. See the{" "}
        <a href="/webhooks" className="text-primary hover:underline">
          Webhooks
        </a>{" "}
        page for payload details.
      </p>
      <ul className="mt-3 space-y-2 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            invoice.issued
          </code>{" "}
          — fires in the same transaction as the payment. Safe to consume
          for accounting automations.
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            invoice.email_sent
          </code>{" "}
          — the invoice email was successfully delivered.
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            invoice.email_failed
          </code>{" "}
          — delivery failed. Subscribe to this and alert the merchant;
          silent email failures are a support ticket factory otherwise.
        </li>
      </ul>

      <SectionHeading>Immutability</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Once issued, invoice rows are never edited. Refunds and corrections
        are handled via credit notes (coming in the Refunds feature), not by
        mutating the original invoice. This is legally required in most
        jurisdictions and keeps your audit trail clean.
      </p>
    </>
  );
}
