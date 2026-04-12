"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  PageShell,
  PageHeader,
  Section,
  DataTable,
  EmptyState,
  KeyValueList,
  CopyableField,
  AddressText,
  col,
} from "@/components/paykit";
import { MetadataEditor } from "@/components/metadata-editor";
import { CancelSubscriptionButton } from "@/components/subscriptions/cancel-subscription-button";
import { TrialActionButton } from "@/components/subscriptions/trial-action-button";
import { formatTrialRemaining } from "@/lib/format-trial";
import { formatDate } from "@/lib/format";
import type { ColumnDef } from "@tanstack/react-table";

type CustomerPaymentRow = {
  id: string;
  amount: number;
  fee: number;
  status: string;
  txHash: string | null;
  createdAt: Date;
  productName: string | null;
};

type CustomerSubscriptionRow = {
  id: string;
  status: string;
  createdAt: Date;
  nextChargeDate: Date | null;
  trialEndsAt: Date | null;
  productName: string | null;
  metadata: Record<string, string>;
};

type CustomerInvoiceRow = {
  id: string;
  number: string;
  totalCents: number;
  currency: string;
  issuedAt: Date;
  emailStatus: "pending" | "sent" | "failed" | "skipped";
  hostedToken: string;
};

const paymentColumns = [
  col.date<CustomerPaymentRow>("createdAt", "Date"),
  col.text<CustomerPaymentRow>("productName", "Product"),
  col.amount<CustomerPaymentRow>("amount", "Amount", { withBadge: true }),
  col.amount<CustomerPaymentRow>("fee", "Fee"),
  col.status<CustomerPaymentRow>("status", "Status", "payment"),
  col.hash<CustomerPaymentRow>("txHash", "Tx Hash"),
];

function money(cents: number, currency: string) {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

const statusVariant: Record<
  CustomerInvoiceRow["emailStatus"],
  "success" | "info" | "warning" | "destructive"
> = {
  sent: "success",
  pending: "info",
  skipped: "warning",
  failed: "destructive",
};

interface CustomerDetailViewProps {
  customer: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    walletAddress: string | null;
    country: string | null;
    taxId: string | null;
    source: string;
  };
  metadata: Record<string, string>;
  payments: CustomerPaymentRow[];
  subscriptions: CustomerSubscriptionRow[];
  invoices: CustomerInvoiceRow[];
}

export default function CustomerDetailView({
  customer,
  metadata: initialMetadata,
  payments,
  subscriptions,
  invoices,
}: CustomerDetailViewProps) {
  const router = useRouter();
  const [metadata, setMetadata] = useState<Record<string, string>>(
    initialMetadata,
  );
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [metadataError, setMetadataError] = useState<string>("");

  async function saveMetadata() {
    setSavingMetadata(true);
    setMetadataError("");
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = data.error ?? "Failed to save metadata";
        setMetadataError(message);
        toast.error(message);
        return;
      }
      setMetadataDirty(false);
      toast.success("Customer metadata saved");
      router.refresh();
    } catch {
      setMetadataError("Failed to save metadata");
      toast.error("Failed to save metadata");
    } finally {
      setSavingMetadata(false);
    }
  }

  const infoItems = [
    { label: "Name", value: customer.name ?? "—" },
    { label: "Email", value: customer.email ?? "—" },
    { label: "Phone", value: customer.phone ?? "—" },
    {
      label: "Wallet",
      value: customer.walletAddress ? (
        <AddressText address={customer.walletAddress} link />
      ) : (
        "—"
      ),
    },
    { label: "Country", value: customer.country ?? "—" },
    { label: "Tax ID", value: customer.taxId ?? "—" },
  ];

  const subscriptionColumns = [
    col.text<CustomerSubscriptionRow>("productName", "Plan"),
    col.status<CustomerSubscriptionRow>("status", "Status", "subscription"),
    col.date<CustomerSubscriptionRow>("createdAt", "Started"),
    {
      accessorKey: "nextChargeDate",
      header: "Next Charge",
      cell: ({ row }) => {
        const r = row.original;
        if (r.status === "trialing") {
          return (
            <span className="font-mono text-xs text-info">
              {formatTrialRemaining(r.trialEndsAt)}
            </span>
          );
        }
        return (
          <span className="text-foreground-muted">
            {r.nextChargeDate ? formatDate(r.nextChargeDate) : "—"}
          </span>
        );
      },
    } satisfies ColumnDef<CustomerSubscriptionRow, unknown>,
    col.actions<CustomerSubscriptionRow>((row) => {
      if (row.status === "trialing") {
        return (
          <TrialActionButton
            subscriptionId={row.id}
            action="cancel"
            productName={row.productName}
          />
        );
      }
      if (row.status === "trial_conversion_failed") {
        return (
          <TrialActionButton
            subscriptionId={row.id}
            action="retry"
            productName={row.productName}
          />
        );
      }
      if (row.status === "active" || row.status === "past_due") {
        return (
          <CancelSubscriptionButton
            subscriptionId={row.id}
            productName={row.productName}
          />
        );
      }
      return <span className="text-foreground-dim">—</span>;
    }),
  ];

  return (
    <PageShell>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/customers">
            <ArrowLeft size={16} />
            Back to Customers
          </Link>
        </Button>
      </div>

      <PageHeader
        title={customer.name ?? "Customer"}
        action={
          customer.source === "manual" ? (
            <Badge variant="info">Manually added</Badge>
          ) : undefined
        }
      />

      <Section title="Details">
        <div className="rounded-lg border border-border bg-surface-1 p-6">
          <KeyValueList items={infoItems} />
          {customer.walletAddress && (
            <div className="mt-6">
              <CopyableField
                label="Wallet Address"
                value={customer.walletAddress}
              />
            </div>
          )}
          <div className="mt-6">
            <MetadataEditor
              value={metadata}
              onChange={(next) => {
                setMetadata(next);
                setMetadataDirty(true);
              }}
              description="Arbitrary tags attached to this customer. Visible via the SDK."
            />
            {metadataError && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{metadataError}</AlertDescription>
              </Alert>
            )}
            <div className="mt-3 flex items-center gap-3">
              <Button
                size="sm"
                onClick={saveMetadata}
                disabled={!metadataDirty || savingMetadata}
              >
                {savingMetadata ? "Saving…" : "Save metadata"}
              </Button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Payments">
        <DataTable
          columns={paymentColumns}
          data={payments}
          emptyState={
            <EmptyState
              title="No payments yet"
              description="This customer hasn't paid you yet."
            />
          }
        />
      </Section>

      {subscriptions.some((s) => s.status === "trialing") && (
        <div className="rounded-lg border border-info/30 bg-info/5 p-4">
          <p className="text-sm font-medium text-foreground">
            Trial in progress
          </p>
          <p className="mt-1 font-mono text-xs text-foreground-muted">
            {formatTrialRemaining(
              subscriptions.find((s) => s.status === "trialing")?.trialEndsAt ??
                null,
            )}
          </p>
        </div>
      )}

      <Section title="Subscriptions">
        <DataTable
          columns={subscriptionColumns}
          data={subscriptions}
          emptyState={
            <EmptyState
              title="No subscriptions"
              description="This customer has no active or past subscriptions."
            />
          }
        />
      </Section>

      <Section title="Invoices">
        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            description="Invoices appear automatically after every successful payment."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-1">
                <tr className="text-xs uppercase tracking-wide text-foreground-muted">
                  <th className="px-4 py-2.5 text-left">Number</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5 text-left">Issued</th>
                  <th className="px-4 py-2.5 text-left">Email</th>
                  <th className="px-4 py-2.5 text-right">Downloads</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr
                    key={i.id}
                    className="border-t border-border/60 transition-colors hover:bg-surface-1"
                  >
                    <td className="px-4 py-2.5 font-mono">
                      <Link
                        href={`/invoices/${i.id}`}
                        className="hover:text-accent"
                      >
                        {i.number}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {money(i.totalCents, i.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-foreground-muted">
                      {i.issuedAt.toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={statusVariant[i.emailStatus]}>
                        {i.emailStatus}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-3 text-xs">
                        <a
                          href={`/i/${i.hostedToken}/pdf`}
                          className="inline-flex items-center gap-1 text-accent hover:underline"
                        >
                          <Download className="h-3 w-3" />
                          Invoice
                        </a>
                        <a
                          href={`/i/${i.hostedToken}/receipt`}
                          className="inline-flex items-center gap-1 text-foreground-muted hover:text-foreground"
                        >
                          <Download className="h-3 w-3" />
                          Receipt
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </PageShell>
  );
}
