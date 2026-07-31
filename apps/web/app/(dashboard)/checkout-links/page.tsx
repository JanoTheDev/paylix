"use client";

import { useCallback, useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  CopyableField,
  col,
} from "@/components/paykit";
import { UsdcBadge } from "@/components/usdc-badge";
import { formatNativeAmount } from "@/lib/amounts";
import { NETWORKS } from "@paylix/config/networks";

interface ProductPrice {
  networkKey: string;
  tokenSymbol: string;
  /** Native token units, serialised as a decimal string. */
  amount: string;
  isActive?: boolean;
}

interface Product {
  id: string;
  name: string;
  type: string;
  prices: ProductPrice[];
}

interface CheckoutSession {
  id: string;
  productId: string;
  productName: string | null;
  customerId: string | null;
  /**
   * Native token units (bigint serialised as a string over the wire) — NOT
   * cents. `payments.amount` is the integer-cents column; this one is not.
   */
  amount: string | number;
  networkKey: string | null;
  tokenSymbol: string | null;
  status:
    | "active"
    | "viewed"
    | "abandoned"
    | "completed"
    | "expired";
  expiresAt: string;
  createdAt: string;
}

type SessionRow = CheckoutSession & {
  createdAtDate: Date;
  expiresAtDate: Date;
};

/** Decimals for a (network, token) pair; falls back to USDC's 6. */
function tokenDecimals(
  networkKey: string | null,
  tokenSymbol: string | null,
): number {
  if (!networkKey || !tokenSymbol) return 6;
  const network = NETWORKS[networkKey as keyof typeof NETWORKS];
  if (!network) return 6;
  const token = network.tokens[tokenSymbol as keyof typeof network.tokens];
  return token?.decimals ?? 6;
}

function formatSessionAmount(
  amount: string | number,
  networkKey: string | null,
  tokenSymbol: string | null,
): string {
  try {
    return formatNativeAmount(
      BigInt(amount),
      tokenDecimals(networkKey, tokenSymbol),
      tokenSymbol ?? "USDC",
    );
  } catch {
    return "—";
  }
}

/**
 * checkout_sessions.amount is native token units, so it must not go through
 * `col.amount` (which divides by 100 for the cents-based payments table).
 */
const nativeAmountColumn: ColumnDef<SessionRow, unknown> = {
  id: "amount",
  header: () => <div className="text-right">Amount</div>,
  cell: ({ row }) => {
    const { amount, networkKey, tokenSymbol } = row.original;
    return (
      <div className="flex items-center justify-end gap-2">
        <span className="font-mono tabular-nums">
          {formatSessionAmount(amount, networkKey, tokenSymbol).split(" ")[0]}
        </span>
        <UsdcBadge symbol={tokenSymbol ?? "USDC"} />
      </div>
    );
  },
};

const columns = [
  col.text<SessionRow>("productName", "Product"),
  col.status<SessionRow>("status", "Status", "checkout"),
  col.mono<SessionRow>("customerId", "Customer ID"),
  nativeAmountColumn,
  col.date<SessionRow>("createdAtDate", "Created"),
  col.date<SessionRow>("expiresAtDate", "Expires"),
];

export default function CheckoutLinksPage() {
  const [sessions, setSessions] = useState<CheckoutSession[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedProductId, setSelectedProductId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [successUrl, setSuccessUrl] = useState("");
  const [cancelUrl, setCancelUrl] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [sessionsRes, productsRes] = await Promise.all([
        fetch("/api/checkout-links"),
        fetch("/api/products"),
      ]);
      if (!sessionsRes.ok || !productsRes.ok) {
        throw new Error("Request failed");
      }
      setSessions(await sessionsRes.json());
      setProducts(await productsRes.json());
    } catch {
      setLoadError("We couldn't load your checkout links.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleGenerate = async () => {
    if (!selectedProductId) return;
    setGenerating(true);
    setError(null);
    try {
      const body: Record<string, string> = { productId: selectedProductId };
      if (customerId.trim()) body.customerId = customerId.trim();
      if (successUrl.trim()) body.successUrl = successUrl.trim();
      if (cancelUrl.trim()) body.cancelUrl = cancelUrl.trim();

      const res = await fetch("/api/checkout-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to generate link");
        return;
      }
      const data = await res.json();
      setGeneratedUrl(data.url);
      fetchData();
    } catch {
      setError("Network error");
    } finally {
      setGenerating(false);
    }
  };

  const resetModal = () => {
    setModalOpen(false);
    setGeneratedUrl(null);
    setSelectedProductId("");
    setCustomerId("");
    setSuccessUrl("");
    setCancelUrl("");
    setError(null);
  };

  const rows: SessionRow[] = sessions.map((s) => ({
    ...s,
    createdAtDate: new Date(s.createdAt),
    expiresAtDate: new Date(s.expiresAt),
  }));

  return (
    <PageShell>
      <PageHeader
        title="Checkout Links"
        description="Share one-time checkout URLs with customers."
        action={
          <Button onClick={() => setModalOpen(true)}>
            <Link2 size={16} strokeWidth={1.5} />
            Generate Link
          </Button>
        }
      />

      {loading ? (
        <LoadingState variant="table" />
      ) : loadError ? (
        <ErrorState description={loadError} onRetry={fetchData} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          emptyState={
            <EmptyState
              title="No checkout sessions yet"
              description="Generate a checkout link to start accepting payments from a customer."
              action={
                <Button variant="outline" onClick={() => setModalOpen(true)}>
                  Generate your first checkout link
                </Button>
              }
            />
          }
        />
      )}

      <Dialog
        open={modalOpen}
        onOpenChange={(v) => (v ? setModalOpen(v) : resetModal())}
      >
        <DialogContent className="border-border bg-surface-1 sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Generate Checkout Link</DialogTitle>
            <DialogDescription>
              Share a one-time checkout URL with a customer.
            </DialogDescription>
          </DialogHeader>

          {generatedUrl ? (
            <div className="flex flex-col gap-3">
              <CopyableField label="Checkout URL" value={generatedUrl} />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="checkout-link-product">Product</Label>
                <Select
                  value={selectedProductId}
                  onValueChange={setSelectedProductId}
                >
                  <SelectTrigger id="checkout-link-product">
                    <SelectValue placeholder="Select a product…" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => {
                      // The link is always minted from the first active price
                      // (see POST /api/checkout-links), so show that one.
                      const price = p.prices?.[0];
                      return (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          {price
                            ? ` — ${formatSessionAmount(
                                price.amount,
                                price.networkKey,
                                price.tokenSymbol,
                              )}`
                            : " — no active price"}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {products.length === 0 && !loading && (
                  <p className="text-xs text-foreground-muted">
                    You don&apos;t have any products yet. Create one first.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="checkout-link-customer">
                  Customer ID{" "}
                  <span className="text-foreground-dim">(optional)</span>
                </Label>
                <Input
                  id="checkout-link-customer"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  placeholder="cus_…"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="checkout-link-success-url">
                  Success URL{" "}
                  <span className="text-foreground-dim">(optional)</span>
                </Label>
                <Input
                  id="checkout-link-success-url"
                  type="url"
                  value={successUrl}
                  onChange={(e) => setSuccessUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="checkout-link-cancel-url">
                  Cancel URL{" "}
                  <span className="text-foreground-dim">(optional)</span>
                </Label>
                <Input
                  id="checkout-link-cancel-url"
                  type="url"
                  value={cancelUrl}
                  onChange={(e) => setCancelUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter>
            {generatedUrl ? (
              <Button variant="outline" onClick={resetModal}>
                Done
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={resetModal}>
                  Cancel
                </Button>
                <Button
                  onClick={handleGenerate}
                  disabled={!selectedProductId || generating}
                >
                  {generating ? "Generating…" : "Generate Link"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
