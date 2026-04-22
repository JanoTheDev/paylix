"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  PageShell,
  PageHeader,
  DataTable,
  EmptyState,
  ExportButton,
  col,
  Amount,
} from "@/components/paykit";
import { Badge } from "@/components/ui/badge";

export type PaymentRow = {
  id: string;
  amount: number;
  fee: number;
  status: string;
  txHash: string | null;
  createdAt: Date;
  productName: string | null;
  productType: string | null;
  customerEmail: string | null;
  customerWallet: string | null;
  invoiceNumber: string | null;
  invoiceHostedToken: string | null;
};

const amountWithType: ColumnDef<PaymentRow, unknown> = {
  accessorKey: "amount",
  header: () => <div className="text-right">Amount</div>,
  cell: ({ row }) => {
    const r = row.original;
    return (
      <div className="flex items-center justify-end gap-2">
        {r.productType === "subscription" && (
          <Badge variant="info" className="font-normal">
            Subscription
          </Badge>
        )}
        <Amount cents={r.amount} withBadge align="right" />
      </div>
    );
  },
};

const columns = [
  col.date<PaymentRow>("createdAt", "Date"),
  col.text<PaymentRow>("productName", "Product"),
  col.customer<PaymentRow>({
    emailKey: "customerEmail",
    walletKey: "customerWallet",
  }),
  amountWithType,
  col.amount<PaymentRow>("fee", "Fee"),
  col.status<PaymentRow>("status", "Status", "payment"),
  col.hash<PaymentRow>("txHash", "Tx Hash"),
  col.actions<PaymentRow>((row) =>
    row.invoiceHostedToken ? (
      <a
        href={`/i/${row.invoiceHostedToken}/pdf`}
        className="text-accent underline-offset-2 hover:underline"
        title={row.invoiceNumber ?? "Invoice"}
      >
        Invoice
      </a>
    ) : (
      <span className="text-foreground-dim">—</span>
    ),
  ),
];

interface PaymentsViewProps {
  rows: PaymentRow[];
}

export default function PaymentsView({ rows }: PaymentsViewProps) {
  return (
    <PageShell>
      <PageHeader
        title="Payments"
        description="All payments received by your account, including subscription charges."
        action={<ExportButton href="/api/payments/export" />}
      />
      <DataTable
        columns={columns}
        data={rows}
        emptyState={
          <EmptyState
            title="No payments yet"
            description="Once a customer pays through a checkout link or subscription, you'll see it here."
          />
        }
      />
    </PageShell>
  );
}
