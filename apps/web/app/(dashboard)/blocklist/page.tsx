"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  ActionMenu,
  col,
} from "@/components/paykit";
import type { ActionItem } from "@/components/paykit";

interface BlocklistEntry {
  id: string;
  type: "wallet" | "email" | "country";
  value: string;
  reason: string | null;
  createdAt: string;
}

type EntryRow = {
  id: string;
  type: "wallet" | "email" | "country";
  value: string;
  reason: string;
  createdAt: Date;
};

export default function BlocklistPage() {
  const [items, setItems] = useState<BlocklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [type, setType] = useState<"wallet" | "email" | "country">("wallet");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/blocklist");
      if (!res.ok) throw new Error("Request failed");
      setItems(await res.json());
    } catch {
      setLoadError("We couldn't load your blocklist.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleAdd() {
    if (!value.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          value: value.trim(),
          reason: reason.trim() || undefined,
        }),
      });
      if (res.ok) {
        setValue("");
        setReason("");
        fetchAll();
        toast.success("Entry added");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error?.message ?? "Failed to add entry");
      }
    } catch {
      toast.error("Failed to add entry");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      const res = await fetch(`/api/blocklist/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchAll();
        toast.success("Entry removed");
      } else {
        toast.error("Failed to remove entry");
      }
    } catch {
      toast.error("Failed to remove entry");
    }
  }

  const rows: EntryRow[] = items.map((e) => ({
    id: e.id,
    type: e.type,
    value: e.value,
    reason: e.reason ?? "",
    createdAt: new Date(e.createdAt),
  }));

  const columns: ColumnDef<EntryRow, unknown>[] = [
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant="warning">{row.original.type}</Badge>
      ),
    },
    col.mono<EntryRow>("value", "Value"),
    col.text<EntryRow>("reason", "Reason"),
    col.date<EntryRow>("createdAt", "Added"),
    col.actions<EntryRow>((row) => {
      const actions: ActionItem[] = [
        {
          label: "Remove",
          variant: "destructive",
          onSelect: () => handleRemove(row.id),
        },
      ];
      return <ActionMenu items={actions} />;
    }),
  ];

  const placeholder =
    type === "wallet"
      ? "0x1234…"
      : type === "email"
      ? "bob@spam.com OR spam.com"
      : "US";

  return (
    <PageShell>
      <PageHeader
        title="Blocklist"
        description="Block specific wallets, emails (full address or domain), or countries from paying through any of your checkouts. Enforced in the relay path before any on-chain activity."
      />

      <div className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-end">
        <div className="flex w-full flex-col gap-2 sm:w-40">
          <Label htmlFor="block-type">Type</Label>
          <Select
            value={type}
            onValueChange={(v) => setType(v as typeof type)}
          >
            <SelectTrigger id="block-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="wallet">Wallet</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="country">Country</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-1">
          <Label htmlFor="block-value">Value</Label>
          <Input
            id="block-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
          />
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-1">
          <Label htmlFor="block-reason">Reason (optional)</Label>
          <Input
            id="block-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Abuse, fraud, etc."
          />
        </div>
        <Button onClick={handleAdd} disabled={adding || !value.trim()}>
          {adding ? "Adding…" : "Add"}
        </Button>
      </div>

      {loading ? (
        <LoadingState variant="table" />
      ) : loadError ? (
        <ErrorState description={loadError} onRetry={fetchAll} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          emptyState={
            <EmptyState
              title="No blocklist entries"
              description="Use the form above to block a wallet, email, or country."
            />
          }
        />
      )}
    </PageShell>
  );
}
