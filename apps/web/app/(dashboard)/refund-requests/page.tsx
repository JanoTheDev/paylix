"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PageShell,
  PageHeader,
  DataTable,
  EmptyState,
  ActionMenu,
  col,
} from "@/components/paykit";
import type { ActionItem } from "@/components/paykit";

interface Req {
  id: string;
  paymentId: string;
  customerId: string;
  amount: number;
  reason: string | null;
  status: "pending" | "approved" | "declined" | "expired";
  merchantReason: string | null;
  decidedAt: string | null;
  refundId: string | null;
  createdAt: string;
}

type Row = {
  id: string;
  paymentId: string;
  amount: number;
  reason: string;
  status: string;
  createdAt: Date;
  raw: Req;
};

export default function RefundRequestsPage() {
  const [items, setItems] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [approveTarget, setApproveTarget] = useState<Req | null>(null);
  const [declineTarget, setDeclineTarget] = useState<Req | null>(null);
  const [txHash, setTxHash] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/refund-requests");
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove() {
    if (!approveTarget) return;
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash.trim())) {
      toast.error("Paste a 32-byte 0x tx hash");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/refund-requests/${approveTarget.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash: txHash.trim() }),
        },
      );
      if (res.ok) {
        toast.success("Refund approved");
        setApproveTarget(null);
        setTxHash("");
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error?.message ?? "Approval failed");
      }
    } catch {
      toast.error("Approval failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline() {
    if (!declineTarget) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/refund-requests/${declineTarget.id}/decline`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: declineReason.trim() || undefined }),
        },
      );
      if (res.ok) {
        toast.success("Request declined");
        setDeclineTarget(null);
        setDeclineReason("");
        load();
      } else {
        toast.error("Decline failed");
      }
    } catch {
      toast.error("Decline failed");
    } finally {
      setBusy(false);
    }
  }

  const rows: Row[] = items.map((r) => ({
    id: r.id,
    paymentId: r.paymentId,
    amount: r.amount,
    reason: r.reason ?? "—",
    status: r.status,
    createdAt: new Date(r.createdAt),
    raw: r,
  }));

  const columns: ColumnDef<Row, unknown>[] = [
    col.date<Row>("createdAt", "Requested"),
    col.amount<Row>("amount", "Amount"),
    col.hash<Row>("paymentId", "Payment"),
    col.text<Row>("reason", "Customer reason"),
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant={
            row.original.status === "pending"
              ? "info"
              : row.original.status === "approved"
                ? "success"
                : "warning"
          }
        >
          {row.original.status}
        </Badge>
      ),
    },
    col.actions<Row>((row) => {
      if (row.status !== "pending")
        return <span className="text-foreground-dim">—</span>;
      const items: ActionItem[] = [
        { label: "Approve", onSelect: () => setApproveTarget(row.raw) },
        {
          label: "Decline",
          variant: "destructive",
          onSelect: () => setDeclineTarget(row.raw),
        },
      ];
      return <ActionMenu items={items} />;
    }),
  ];

  return (
    <PageShell>
      <PageHeader
        title="Refund requests"
        description="Customer-initiated refund requests. Approve by sending USDC back from your merchant wallet and pasting the tx hash; Paylix verifies on-chain before recording. Decline with an optional reason that shows up in the customer's portal."
      />

      {loading ? (
        <div className="rounded-lg border border-border bg-surface-1 py-16 text-center text-sm text-foreground-muted">
          Loading…
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          emptyState={
            <EmptyState
              title="No refund requests"
              description="When a customer requests a refund via the portal, it shows up here."
            />
          }
        />
      )}

      <Dialog
        open={approveTarget !== null}
        onOpenChange={(v) => !v && setApproveTarget(null)}
      >
        <DialogContent className="border-border bg-surface-1 sm:max-w-[480px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Approve refund request</DialogTitle>
            <DialogDescription>
              Send ${approveTarget ? (approveTarget.amount / 100).toFixed(2) : "0.00"} USDC
              from the merchant wallet on this payment back to the
              buyer, then paste the tx hash below. Paylix verifies the
              transfer on-chain before recording.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-sm">
            <Label htmlFor="rf-tx">Transfer tx hash</Label>
            <Input
              id="rf-tx"
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              placeholder="0x…"
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleApprove} disabled={busy}>
              {busy ? "Verifying…" : "Approve + record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={declineTarget !== null}
        onOpenChange={(v) => !v && setDeclineTarget(null)}
      >
        <DialogContent className="border-border bg-surface-1 sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Decline refund request</DialogTitle>
            <DialogDescription>
              The customer sees your reason in their portal. Keep it
              short and direct.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-sm">
            <Label htmlFor="rf-reason">Reason (optional)</Label>
            <Input
              id="rf-reason"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Outside refund window"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDecline}
              disabled={busy}
            >
              {busy ? "Declining…" : "Decline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
