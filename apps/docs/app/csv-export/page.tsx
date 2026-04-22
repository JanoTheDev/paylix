import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "CSV Export" };

export default function CsvExportPage() {
  return (
    <>
      <PageHeading
        title="CSV Export"
        description="Download your payments, subscriptions, invoices, and customers as CSV for accounting tools, reporting, or backup."
      />

      <SectionHeading>From the dashboard</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Click the <strong>Export CSV</strong> button in the header of the
        Payments or Customers page. The file downloads immediately with a
        name like{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          paylix-payments-live-2026-04-22.csv
        </code>
        . Test mode and live mode export separate files.
      </p>

      <SectionHeading>Endpoints</SectionHeading>
      <ul className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-foreground-muted">
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            GET /api/payments/export
          </code>
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            GET /api/subscriptions/export
          </code>
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            GET /api/invoices/export
          </code>
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            GET /api/customers/export
          </code>
        </li>
      </ul>

      <SubsectionHeading>Format</SubsectionHeading>
      <ul className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-foreground-muted">
        <li>UTF-8, RFC 4180. Commas/quotes/newlines are escaped properly.</li>
        <li>Dates are ISO 8601 (UTC).</li>
        <li>Amounts are integer cents; the token symbol is a separate column.</li>
        <li>
          Metadata expands to <code>metadata.&lt;key&gt;</code> columns. Keys
          are unioned across all rows in the file.
        </li>
      </ul>

      <Callout variant="info" title="50,000 row cap">
        Exports are capped at 50,000 rows per download. When the cap is
        hit the response carries an{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          X-Paylix-Truncated: true
        </code>{" "}
        header and the dashboard shows a warning toast. Narrow your
        filters (status, date range) and run multiple exports for full
        historical pulls.
      </Callout>

      <SectionHeading>No secrets in CSVs</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        API key hashes, webhook secrets, and permit signatures are never
        included in any export.
      </p>

      <CodeBlock language="bash">{`# Requires an authenticated dashboard session cookie.
curl -L --cookie-jar paylix.cookies \\
  "https://pay.example.com/api/payments/export?status=confirmed" \\
  -o payments.csv`}</CodeBlock>
    </>
  );
}
