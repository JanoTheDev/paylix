"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  PageShell,
  PageHeader,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  ConfirmDialog,
  ActionMenu,
  col,
} from "@/components/paykit";
import type { ActionItem } from "@/components/paykit";

interface Coupon {
  id: string;
  code: string;
  type: "percent" | "fixed";
  percentOff: number | null;
  amountOffCents: number | null;
  duration: "once" | "forever" | "repeating";
  durationInCycles: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  redeemBy: string | null;
  firstTimeCustomerOnly: boolean;
  isActive: boolean;
  createdAt: string;
}

type CouponRow = {
  id: string;
  code: string;
  discount: string;
  duration: string;
  redemptions: string;
  state: "active" | "archived";
  createdAt: Date;
  isActive: boolean;
};

function formatDiscount(c: Coupon): string {
  if (c.type === "percent") return `${c.percentOff}% off`;
  return `$${((c.amountOffCents ?? 0) / 100).toFixed(2)} off`;
}

function formatDuration(c: Coupon): string {
  if (c.duration === "once") return "First charge only";
  if (c.duration === "forever") return "All charges";
  return `${c.durationInCycles} cycles`;
}

export default function CouponsPage() {
  const [items, setItems] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveId, setArchiveId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [percentOff, setPercentOff] = useState("");
  const [amountOff, setAmountOff] = useState("");
  const [duration, setDuration] = useState<"once" | "forever" | "repeating">(
    "once",
  );
  const [cycles, setCycles] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchCoupons = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/coupons");
      if (!res.ok) throw new Error("Request failed");
      setItems(await res.json());
    } catch {
      setLoadError("We couldn't load your coupons.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCoupons();
  }, [fetchCoupons]);

  async function handleCreate() {
    if (!code.trim()) return;
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        code: code.trim(),
        type,
        duration,
      };
      if (type === "percent") body.percentOff = Number(percentOff);
      if (type === "fixed") body.amountOffCents = Math.round(Number(amountOff) * 100);
      if (duration === "repeating") body.durationInCycles = Number(cycles);
      if (maxRedemptions) body.maxRedemptions = Number(maxRedemptions);

      const res = await fetch("/api/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setCreateOpen(false);
        setCode("");
        setPercentOff("");
        setAmountOff("");
        setCycles("");
        setMaxRedemptions("");
        fetchCoupons();
        toast.success("Coupon created");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error?.message ?? "Failed to create coupon");
      }
    } catch {
      toast.error("Failed to create coupon");
    } finally {
      setCreating(false);
    }
  }

  async function handleArchive(id: string) {
    try {
      const res = await fetch(`/api/coupons/${id}`, { method: "DELETE" });
      if (res.ok) {
        setArchiveId(null);
        fetchCoupons();
        toast.success("Coupon archived");
      } else {
        toast.error("Failed to archive coupon");
      }
    } catch {
      toast.error("Failed to archive coupon");
    }
  }

  const rows: CouponRow[] = items.map((c) => ({
    id: c.id,
    code: c.code,
    discount: formatDiscount(c),
    duration: formatDuration(c),
    redemptions:
      c.maxRedemptions !== null
        ? `${c.redemptionCount} / ${c.maxRedemptions}`
        : `${c.redemptionCount}`,
    state: c.isActive ? "active" : "archived",
    createdAt: new Date(c.createdAt),
    isActive: c.isActive,
  }));

  const columns: ColumnDef<CouponRow, unknown>[] = [
    col.mono<CouponRow>("code", "Code"),
    col.text<CouponRow>("discount", "Discount"),
    col.text<CouponRow>("duration", "Duration"),
    col.text<CouponRow>("redemptions", "Redemptions"),
    {
      accessorKey: "state",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "info" : "warning"}>
          {row.original.isActive ? "Active" : "Archived"}
        </Badge>
      ),
    },
    col.date<CouponRow>("createdAt", "Created"),
    col.actions<CouponRow>((row) => {
      if (!row.isActive) return null;
      const actions: ActionItem[] = [
        {
          label: "Archive",
          variant: "destructive",
          onSelect: () => setArchiveId(row.id),
        },
      ];
      return <ActionMenu items={actions} />;
    }),
  ];

  return (
    <PageShell>
      <PageHeader
        title="Coupons"
        description="Create discount codes buyers can apply at checkout. One-time payments only for now; subscription support is in the works."
        action={<Button onClick={() => setCreateOpen(true)}>New Coupon</Button>}
      />

      {loading ? (
        <LoadingState variant="table" />
      ) : loadError ? (
        <ErrorState description={loadError} onRetry={fetchCoupons} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          emptyState={
            <EmptyState
              title="No coupons yet"
              description="Create your first discount code to offer buyers a promotion at checkout."
              action={
                <Button variant="outline" onClick={() => setCreateOpen(true)}>
                  Create your first coupon
                </Button>
              }
            />
          }
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-border bg-surface-1 sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>New Coupon</DialogTitle>
            <DialogDescription>
              Codes are stored uppercase; buyers can type them case-insensitively.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="SPRING25"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent off</SelectItem>
                  <SelectItem value="fixed">Fixed amount off</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {type === "percent" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="percent">Percent off</Label>
                <Input
                  id="percent"
                  type="number"
                  min={1}
                  max={100}
                  value={percentOff}
                  onChange={(e) => setPercentOff(e.target.value)}
                  placeholder="25"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="amount">Amount off (USD)</Label>
                <Input
                  id="amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={amountOff}
                  onChange={(e) => setAmountOff(e.target.value)}
                  placeholder="5.00"
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="duration">Duration</Label>
              <Select
                value={duration}
                onValueChange={(v) => setDuration(v as typeof duration)}
              >
                <SelectTrigger id="duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Once</SelectItem>
                  <SelectItem value="forever">Forever</SelectItem>
                  <SelectItem value="repeating">Repeating (N cycles)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {duration === "repeating" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="cycles">Cycles</Label>
                <Input
                  id="cycles"
                  type="number"
                  min={1}
                  value={cycles}
                  onChange={(e) => setCycles(e.target.value)}
                  placeholder="3"
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="max">Max redemptions (optional)</Label>
              <Input
                id="max"
                type="number"
                min={1}
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                placeholder="100"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !code.trim()}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={archiveId !== null}
        onOpenChange={(v) => !v && setArchiveId(null)}
        title="Archive Coupon"
        description="Archived coupons can no longer be redeemed at checkout. Existing redemptions remain intact."
        confirmLabel="Archive"
        variant="destructive"
        onConfirm={() => {
          if (archiveId) handleArchive(archiveId);
        }}
      />
    </PageShell>
  );
}
