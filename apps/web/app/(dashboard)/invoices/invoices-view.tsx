"use client";

import Link from "next/link";
import { PageShell, PageHeader } from "@/components/paykit";
import { Badge } from "@/components/ui/badge";

export interface InvoiceRow {
  id: string;
  number: string;
  totalCents: number;
  currency: string;
  issuedAt: string;
  emailStatus: "pending" | "sent" | "failed" | "skipped";
  hostedToken: string;
  customerLabel: string;
}

function money(cents: number, currency: string) {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

const statusVariant: Record<
  InvoiceRow["emailStatus"],
  "success" | "info" | "warning" | "destructive"
> = {
  sent: "success",
  pending: "info",
  skipped: "warning",
  failed: "destructive",
};

export default function InvoicesView({ invoices }: { invoices: InvoiceRow[] }) {
  return (
    <PageShell>
      <PageHeader title="Invoices" />
      {invoices.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No invoices yet. They appear automatically for every successful payment.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-foreground-muted">
              <th className="py-2 text-left">Number</th>
              <th className="py-2 text-left">Customer</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2 text-left">Issued</th>
              <th className="py-2 text-left">Email</th>
              <th className="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-b border-border/60">
                <td className="py-2 font-mono">
                  <Link href={`/invoices/${i.id}`}>{i.number}</Link>
                </td>
                <td className="py-2">{i.customerLabel}</td>
                <td className="py-2 text-right font-mono">
                  {money(i.totalCents, i.currency)}
                </td>
                <td className="py-2">
                  {new Date(i.issuedAt).toLocaleDateString()}
                </td>
                <td className="py-2">
                  <Badge variant={statusVariant[i.emailStatus]}>
                    {i.emailStatus}
                  </Badge>
                </td>
                <td className="py-2 text-right">
                  <a
                    className="text-accent underline"
                    href={`/i/${i.hostedToken}/pdf`}
                  >
                    Download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PageShell>
  );
}
