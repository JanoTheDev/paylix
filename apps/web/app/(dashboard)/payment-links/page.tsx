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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface PaymentLink {
  id: string;
  productId: string;
  name: string;
  networkKey: string | null;
  tokenSymbol: string | null;
  isActive: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  createdAt: string;
}

interface Product {
  id: string;
  name: string;
  type: "one_time" | "subscription";
}

type LinkRow = {
  id: string;
  name: string;
  productName: string;
  currency: string;
  redemptions: string;
  url: string;
  state: "active" | "archived";
  createdAt: Date;
  isActive: boolean;
};

export default function PaymentLinksPage() {
  const [items, setItems] = useState<PaymentLink[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveId, setArchiveId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [productId, setProductId] = useState<string>("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [creating, setCreating] = useState(false);

  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [linksRes, productsRes] = await Promise.all([
        fetch("/api/payment-links"),
        fetch("/api/products"),
      ]);
      if (!linksRes.ok || !productsRes.ok) throw new Error("Request failed");
      setItems(await linksRes.json());
      setProducts(await productsRes.json());
    } catch {
      setLoadError("We couldn't load your payment links.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleCreate() {
    if (!name.trim() || !productId) return;
    setCreating(true);
    try {
      const body: Record<string, unknown> = { productId, name: name.trim() };
      if (maxRedemptions) body.maxRedemptions = Number(maxRedemptions);

      const res = await fetch("/api/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setCreateOpen(false);
        setName("");
        setProductId("");
        setMaxRedemptions("");
        fetchAll();
        toast.success("Payment link created");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error?.message ?? "Failed to create link");
      }
    } catch {
      toast.error("Failed to create link");
    } finally {
      setCreating(false);
    }
  }

  async function handleArchive(id: string) {
    try {
      const res = await fetch(`/api/payment-links/${id}`, { method: "DELETE" });
      if (res.ok) {
        setArchiveId(null);
        fetchAll();
        toast.success("Link archived");
      } else {
        toast.error("Failed to archive link");
      }
    } catch {
      toast.error("Failed to archive link");
    }
  }

  function copyUrl(id: string) {
    const url = `${origin}/pay/${id}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("URL copied"),
      () => toast.error("Copy failed"),
    );
  }

  const productName = (id: string) =>
    products.find((p) => p.id === id)?.name ?? "—";

  const rows: LinkRow[] = items.map((l) => ({
    id: l.id,
    name: l.name,
    productName: productName(l.productId),
    currency:
      l.networkKey && l.tokenSymbol
        ? `${l.tokenSymbol} on ${l.networkKey}`
        : "Buyer picks",
    redemptions:
      l.maxRedemptions !== null
        ? `${l.redemptionCount} / ${l.maxRedemptions}`
        : `${l.redemptionCount}`,
    url: `${origin}/pay/${l.id}`,
    state: l.isActive ? "active" : "archived",
    createdAt: new Date(l.createdAt),
    isActive: l.isActive,
  }));

  const columns: ColumnDef<LinkRow, unknown>[] = [
    col.text<LinkRow>("name", "Name"),
    col.text<LinkRow>("productName", "Product"),
    col.text<LinkRow>("currency", "Currency"),
    col.text<LinkRow>("redemptions", "Redemptions"),
    col.mono<LinkRow>("url", "URL"),
    {
      accessorKey: "state",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "info" : "warning"}>
          {row.original.isActive ? "Active" : "Archived"}
        </Badge>
      ),
    },
    col.date<LinkRow>("createdAt", "Created"),
    col.actions<LinkRow>((row) => {
      const items: ActionItem[] = [
        { label: "Copy URL", onSelect: () => copyUrl(row.id) },
      ];
      if (row.isActive) {
        items.push({
          label: "Archive",
          variant: "destructive",
          onSelect: () => setArchiveId(row.id),
        });
      }
      return <ActionMenu items={items} />;
    }),
  ];

  return (
    <PageShell>
      <PageHeader
        title="Payment Links"
        description="Permanent URLs that spawn a fresh checkout session on every visit. Share them on socials or profiles; each visitor gets their own session."
        action={<Button onClick={() => setCreateOpen(true)}>New Link</Button>}
      />

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
              title="No payment links yet"
              description="Create a reusable link to collect payments without generating a session per buyer."
              action={
                <Button variant="outline" onClick={() => setCreateOpen(true)}>
                  Create your first link
                </Button>
              }
            />
          }
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-border bg-surface-1 sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>New Payment Link</DialogTitle>
            <DialogDescription>
              The URL is permanent; every visit creates a new checkout session
              against the chosen product.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Twitter bio link"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="product">Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger id="product">
                  <SelectValue placeholder="Pick a product" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
            <Button onClick={handleCreate} disabled={creating || !name.trim() || !productId}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={archiveId !== null}
        onOpenChange={(v) => !v && setArchiveId(null)}
        title="Archive Payment Link"
        description="Archived links render an expired page to future visitors. Existing checkout sessions created from this link are unaffected."
        confirmLabel="Archive"
        variant="destructive"
        onConfirm={() => {
          if (archiveId) handleArchive(archiveId);
        }}
      />
    </PageShell>
  );
}
