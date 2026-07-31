"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyIconButton } from "@/components/paykit";
import { useMerchantNetworks } from "@/components/networks/use-merchant-networks";

const BILLING_INTERVALS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 Weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const;

export function OnboardingWizard({
  hasWallet,
}: {
  hasWallet: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Step 2 — product fields
  const [productName, setProductName] = useState("");
  const [productType, setProductType] = useState<"one_time" | "subscription">("one_time");
  const [billingInterval, setBillingInterval] = useState("");
  type PriceEntry = {
    id: string;
    networkKey: string;
    tokenSymbol: string;
    amount: string;
  };
  const makePriceEntry = (): PriceEntry => ({
    id: crypto.randomUUID(),
    networkKey: "",
    tokenSymbol: "",
    amount: "",
  });
  const [prices, setPrices] = useState<PriceEntry[]>([makePriceEntry()]);
  const [trialDays, setTrialDays] = useState("");
  const {
    networks: enabledNetworks,
    loading: networksLoading,
    error: networksError,
  } = useMerchantNetworks(productType);

  // Step 3 — wallet
  const [walletAddress, setWalletAddress] = useState("");

  // Step 4 — result
  const [checkoutUrl, setCheckoutUrl] = useState("");

  async function createProduct() {
    setError("");
    if (!productName.trim()) {
      setError("Product name is required");
      return;
    }
    if (prices.every((p) => !p.networkKey || !p.tokenSymbol || !p.amount.trim())) {
      setError("At least one price with network, token, and amount is required");
      return;
    }
    if (productType === "subscription" && !billingInterval) {
      setError("Billing interval is required for subscriptions");
      return;
    }

    setSubmitting(true);
    try {
      const { NETWORKS } = await import("@paylix/config/networks");
      const { toNativeUnits } = await import("@/lib/amounts");

      const pricePayload = prices
        .filter((p) => p.networkKey && p.tokenSymbol && p.amount.trim())
        .map((p) => {
          const network = NETWORKS[p.networkKey as keyof typeof NETWORKS];
          const token = network
            ? (network.tokens as Record<string, { decimals: number }>)[
                p.tokenSymbol
              ]
            : undefined;
          if (!token) {
            throw new Error(
              `Unknown token ${p.tokenSymbol} on ${p.networkKey}`,
            );
          }
          return {
            networkKey: p.networkKey,
            tokenSymbol: p.tokenSymbol,
            amount: toNativeUnits(p.amount, token.decimals).toString(),
          };
        });

      if (pricePayload.length === 0) {
        setError("At least one price is required");
        setSubmitting(false);
        return;
      }

      const payload: Record<string, unknown> = {
        name: productName,
        type: productType,
        prices: pricePayload,
        checkoutFields: { email: true },
      };
      if (productType === "subscription" && billingInterval) {
        payload.billingInterval = billingInterval;
      }
      const td = parseInt(trialDays, 10);
      if (productType === "subscription" && td > 0) {
        payload.trialDays = td;
      }

      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error?.message ?? body.error ?? "Failed to create product");
        setSubmitting(false);
        return;
      }

      const product = await res.json();

      if (hasWallet) {
        await generateCheckoutLink(product.id);
        setStep(4);
      } else {
        setStep(3);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveWallet() {
    setError("");
    if (!walletAddress.trim() || !walletAddress.startsWith("0x")) {
      setError("Enter a valid 0x wallet address");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to save wallet");
        setSubmitting(false);
        return;
      }

      const productsRes = await fetch("/api/products");
      if (productsRes.ok) {
        const prods = await productsRes.json();
        if (prods.length > 0) {
          await generateCheckoutLink(prods[prods.length - 1].id);
        }
      }

      setStep(4);
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function generateCheckoutLink(productId: string) {
    const res = await fetch("/api/checkout-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    if (res.ok) {
      const data = await res.json();
      setCheckoutUrl(data.url);
    }
  }


  const totalSteps = hasWallet ? 3 : 4;
  const displayStep = hasWallet && step >= 3 ? step - 1 : step;
  const stepDotIds = useMemo(
    () => Array.from({ length: totalSteps }, () => crypto.randomUUID()),
    [totalSteps],
  );

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-16">
      <div className="mb-8 flex items-center gap-2">
        {stepDotIds.map((dotId, i) => {
          const stepNum = i + 1;
          const isCurrent = displayStep === stepNum;
          const isPast = displayStep > stepNum;
          return (
            <div
              key={dotId}
              className={
                "h-2 w-8 rounded-full transition-colors " +
                (isCurrent
                  ? "bg-primary"
                  : isPast
                    ? "bg-primary/40"
                    : "bg-surface-3")
              }
            />
          );
        })}
        <span className="ml-2 text-xs text-foreground-muted">
          Step {displayStep} of {totalSteps}
        </span>
      </div>

      {step === 1 && (
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
            <Rocket size={32} className="text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.4px]">
            Welcome to Paylix
          </h1>
          <p className="mt-2 max-w-md text-sm text-foreground-muted">
            Let&apos;s create your first product and start accepting payments in
            under 2 minutes.
          </p>
          <Button className="mt-6" onClick={() => setStep(2)}>
            Get started
          </Button>
        </div>
      )}

      {step === 2 && (
        <Card className="w-full">
          <CardContent className="space-y-4">
            <div className="text-center">
              <h2 className="text-lg font-semibold">Create your first product</h2>
              <p className="mt-1 text-sm text-foreground-muted">
                This is what your customers will pay for.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1">
              <Label htmlFor="onb-name">Product name</Label>
              <Input
                id="onb-name"
                placeholder="e.g. Pro Plan"
                maxLength={100}
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="onb-type">Type</Label>
              <Select
                value={productType}
                onValueChange={(v) => setProductType(v as "one_time" | "subscription")}
              >
                <SelectTrigger id="onb-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_time">One-time payment</SelectItem>
                  <SelectItem value="subscription">Subscription</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {productType === "subscription" && (
              <div className="space-y-1">
                <Label htmlFor="onb-interval">Billing interval</Label>
                <Select value={billingInterval} onValueChange={setBillingInterval}>
                  <SelectTrigger id="onb-interval">
                    <SelectValue placeholder="Select interval" />
                  </SelectTrigger>
                  <SelectContent>
                    {BILLING_INTERVALS.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {productType === "subscription" && (
              <div className="space-y-1">
                <Label htmlFor="onb-trial">Trial period (days, optional)</Label>
                <Input
                  id="onb-trial"
                  type="number"
                  min={0}
                  max={365}
                  placeholder="0"
                  className="font-mono"
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                />
              </div>
            )}

            <fieldset className="min-w-0 space-y-2">
              <legend className="text-sm leading-none font-medium">
                Prices
              </legend>
              {networksError && (
                <p role="alert" className="text-xs text-destructive">
                  {networksError}
                </p>
              )}
              {networksLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-2/3" />
                </div>
              ) : enabledNetworks.length === 0 ? (
                <p className="text-xs text-destructive">
                  No networks enabled. Go to Settings and enable at least one
                  network first.
                </p>
              ) : (
                <>
                  {prices.map((price, idx) => (
                    <div key={price.id} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground-muted">Price {idx + 1}</span>
                        {prices.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setPrices((p) => p.filter((entry) => entry.id !== price.id))}
                            className="text-xs text-destructive hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Select
                          value={price.networkKey}
                          onValueChange={(v) => {
                            setPrices((prev) =>
                              prev.map((entry) =>
                                entry.id === price.id
                                  ? { ...entry, networkKey: v, tokenSymbol: "" }
                                  : entry,
                              ),
                            );
                          }}
                        >
                          <SelectTrigger aria-label={`Price ${idx + 1} network`}>
                            <SelectValue placeholder="Network" />
                          </SelectTrigger>
                          <SelectContent>
                            {enabledNetworks.map((n) => (
                              <SelectItem key={n.networkKey} value={n.networkKey}>{n.displayLabel}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={price.tokenSymbol}
                          onValueChange={(v) => {
                            setPrices((prev) =>
                              prev.map((entry) =>
                                entry.id === price.id ? { ...entry, tokenSymbol: v } : entry,
                              ),
                            );
                          }}
                        >
                          <SelectTrigger aria-label={`Price ${idx + 1} token`}>
                            <SelectValue placeholder="Token" />
                          </SelectTrigger>
                          <SelectContent>
                            {enabledNetworks
                              .find((n) => n.networkKey === price.networkKey)
                              ?.tokens.map((t) => (
                                <SelectItem
                                  key={t.symbol}
                                  value={t.symbol}
                                  disabled={!t.usable}
                                >
                                  {t.symbol}
                                  {t.bridged ? " (bridged)" : ""}
                                  {!t.usable ? " — coming soon" : ""}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <Input
                          aria-label={`Price ${idx + 1} amount`}
                          type="text"
                          inputMode="decimal"
                          placeholder="10.00"
                          className="font-mono"
                          value={price.amount}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPrices((prev) =>
                              prev.map((entry) =>
                                entry.id === price.id ? { ...entry, amount: val } : entry,
                              ),
                            );
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPrices((p) => [...p, makePriceEntry()])}
                  >
                    + Add price
                  </Button>
                </>
              )}
              <p className="text-xs text-foreground-muted">
                In token units (e.g. 10.00 USDC).
              </p>
            </fieldset>

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={createProduct} disabled={submitting}>
                {submitting ? "Creating..." : "Create product"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && !hasWallet && (
        <Card className="w-full">
          <CardContent className="space-y-4">
            <div className="text-center">
              <h2 className="text-lg font-semibold">Set up your payout wallet</h2>
              <p className="mt-1 text-sm text-foreground-muted">
                This is where your USDC payments will be deposited.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1">
              <Label htmlFor="onb-wallet">Wallet address</Label>
              <Input
                id="onb-wallet"
                type="text"
                placeholder="0x..."
                className="font-mono"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
              />
              <p className="text-xs text-foreground-muted">
                Paste the 0x address of a wallet you control.
              </p>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={saveWallet} disabled={submitting}>
                {submitting ? "Saving..." : "Save wallet"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <div className="flex flex-col items-center text-center">
          <CheckCircle2 size={48} className="mb-4 text-primary" />
          <h2 className="text-xl font-semibold">You&apos;re all set!</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            Your first product is ready.
            {checkoutUrl
              ? " Share this checkout link with your customers:"
              : ""}
          </p>
          {checkoutUrl && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2">
              <code className="max-w-[320px] truncate font-mono text-sm text-foreground">
                {checkoutUrl}
              </code>
              <CopyIconButton value={checkoutUrl} label="Copy checkout URL" />
            </div>
          )}
          <Button
            className="mt-6"
            onClick={() => {
              router.push("/overview");
              router.refresh();
            }}
          >
            Go to dashboard
          </Button>
        </div>
      )}
    </div>
  );
}
