"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import {
  PageShell,
  PageHeader,
  DataTable,
  EmptyState,
  ExportButton,
  ActionMenu,
  col,
  Amount,
} from "@/components/paykit";
import type { ActionItem } from "@/components/paykit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaymentDetailDrawer } from "@/components/payments/payment-detail-drawer";

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
  fromAddress: string | null;
  toAddress: string | null;
  refundedCents: number;
};

function refundState(r: PaymentRow): "none" | "partial" | "full" {
  if (r.refundedCents >= r.amount) return "full";
  if (r.refundedCents > 0) return "partial";
  return "none";
}

interface PaymentsViewProps {
  rows: PaymentRow[];
}

export default function PaymentsView({ rows: initialRows }: PaymentsViewProps) {
  const [rows, setRows] = useState(initialRows);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<PaymentRow | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundTxHash, setRefundTxHash] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function openRefund(row: PaymentRow) {
    const remaining = row.amount - row.refundedCents;
    setRefundTarget(row);
    setRefundAmount((remaining / 100).toFixed(2));
    setRefundReason("");
    setRefundTxHash("");
  }

  async function submitRefund() {
    if (!refundTarget) return;
    const cents = Math.round(Number(refundAmount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(refundTxHash.trim())) {
      toast.error("Enter a 32-byte 0x-prefixed tx hash");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/payments/${refundTarget.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: cents,
          reason: refundReason.trim() || undefined,
          txHash: refundTxHash.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error?.message ?? "Refund verification failed");
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === refundTarget.id
            ? { ...r, refundedCents: r.refundedCents + cents }
            : r,
        ),
      );
      setRefundTarget(null);
      toast.success("Refund recorded");
    } catch {
      toast.error("Refund failed");
    } finally {
      setSubmitting(false);
    }
  }

  const amountWithType: ColumnDef<PaymentRow, unknown> = {
    accessorKey: "amount",
    header: () => <div className="text-right">Amount</div>,
    cell: ({ row }) => {
      const r = row.original;
      const state = refundState(r);
      return (
        <div className="flex items-center justify-end gap-2">
          {state === "full" && <Badge variant="warning">Refunded</Badge>}
          {state === "partial" && (
            <Badge variant="warning">Partial refund</Badge>
          )}
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

  const columns: ColumnDef<PaymentRow, unknown>[] = [
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
    col.actions<PaymentRow>((row) => {
      const state = refundState(row);
      const items: ActionItem[] = [
        { label: "View details", onSelect: () => setDetailId(row.id) },
      ];
      if (row.invoiceHostedToken) {
        items.push({
          label: "Invoice",
          onSelect: () => {
            window.open(`/i/${row.invoiceHostedToken}/pdf`, "_blank");
          },
        });
      }
      if (row.status === "confirmed" && state !== "full") {
        items.push({
          label: state === "partial" ? "Refund remaining" : "Refund",
          onSelect: () => openRefund(row),
        });
      }
      return <ActionMenu items={items} />;
    }),
  ];

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

      <Dialog
        open={refundTarget !== null}
        onOpenChange={(v) => !v && setRefundTarget(null)}
      >
        <DialogContent className="border-border bg-surface-1 sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record a refund</DialogTitle>
            <DialogDescription>
              Refunds are non-custodial. Send USDC from your merchant
              wallet to the buyer, then paste the tx hash here. Paylix
              verifies the transfer on-chain before recording it. The
              0.5% platform fee on the original charge is not returned;
              you bear the full refund amount.
            </DialogDescription>
          </DialogHeader>
          {refundTarget && (
            <div className="flex flex-col gap-4 text-sm">
              <div className="rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground-muted">
                <div>
                  From:{" "}
                  <span className="text-foreground">
                    {refundTarget.toAddress ?? "(merchant wallet)"}
                  </span>
                </div>
                <div>
                  To:{" "}
                  <span className="text-foreground">
                    {refundTarget.fromAddress ?? "(buyer wallet)"}
                  </span>
                </div>
                <div>
                  Already refunded:{" "}
                  <span className="text-foreground">
                    ${(refundTarget.refundedCents / 100).toFixed(2)}
                  </span>{" "}
                  / ${(refundTarget.amount / 100).toFixed(2)}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="rf-amount">Amount (USD)</Label>
                <Input
                  id="rf-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="rf-txhash">Refund tx hash</Label>
                <Input
                  id="rf-txhash"
                  value={refundTxHash}
                  onChange={(e) => setRefundTxHash(e.target.value)}
                  placeholder="0x…"
                  className="font-mono"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="rf-reason">Reason (optional)</Label>
                <Input
                  id="rf-reason"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Customer requested refund"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitRefund} disabled={submitting}>
              {submitting ? "Verifying…" : "Record refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PaymentDetailDrawer
        paymentId={detailId}
        onClose={() => setDetailId(null)}
      />
    </PageShell>
  );
}
