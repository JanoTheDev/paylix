"use client";

import { useEffect, useState } from "react";
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
import { CopyIconButton } from "@/components/paykit";

const BILLING_INTERVALS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 Weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const;

const STEPS = ["Welcome", "Create product", "Payout wallet", "Done"] as const;

interface NetworkInfo {
  networkKey: string;
  chainName: string;
  displayLabel: string;
  tokens: string[];
}

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
  const [amount, setAmount] = useState("");
  const [trialDays, setTrialDays] = useState("");
  const [networkKey, setNetworkKey] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [enabledNetworks, setEnabledNetworks] = useState<NetworkInfo[]>([]);

  // Step 3 — wallet
  const [walletAddress, setWalletAddress] = useState("");

  // Step 4 — result
  const [checkoutUrl, setCheckoutUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then(async (data) => {
        if (cancelled || !data?.networks) return;
        const { NETWORKS } = await import("@paylix/config/networks");
        const enabled: NetworkInfo[] = data.networks
          .filter((n: { enabled: boolean }) => n.enabled)
          .map((n: { networkKey: string; chainName: string; displayLabel: string }) => ({
            networkKey: n.networkKey,
            chainName: n.chainName,
            displayLabel: n.displayLabel,
            tokens: Object.keys(
              NETWORKS[n.networkKey as keyof typeof NETWORKS].tokens,
            ),
          }));
        if (!cancelled) setEnabledNetworks(enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function createProduct() {
    setError("");
    if (!productName.trim()) {
      setError("Product name is required");
      return;
    }
    if (!networkKey || !tokenSymbol || !amount.trim()) {
      setError("Network, token, and amount are required");
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

      const network = NETWORKS[networkKey as keyof typeof NETWORKS];
      const token = (network.tokens as Record<string, (typeof network.tokens)[keyof typeof network.tokens]>)[tokenSymbol];
      if (!token) {
        setError(`Unknown token ${tokenSymbol}`);
        setSubmitting(false);
        return;
      }

      const nativeAmount = toNativeUnits(amount, token.decimals).toString();

      const payload: Record<string, unknown> = {
        name: productName,
        type: productType,
        prices: [{ networkKey, tokenSymbol, amount: nativeAmount }],
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
    } catch {
      setError("Network error");
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

  const currentStepIndex = step;
  const totalSteps = hasWallet ? 3 : 4;
  const displayStep = hasWallet && step >= 3 ? step - 1 : step;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-16">
      <div className="mb-8 flex items-center gap-2">
        {Array.from({ length: totalSteps }, (_, i) => {
          const stepNum = i + 1;
          const isCurrent = displayStep === stepNum;
          const isPast = displayStep > stepNum;
          return (
            <div
              key={i}
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
            Let's create your first product and start accepting payments in
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
              <Label>Type</Label>
              <Select
                value={productType}
                onValueChange={(v) => setProductType(v as "one_time" | "subscription")}
              >
                <SelectTrigger>
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
                <Label>Billing interval</Label>
                <Select value={billingInterval} onValueChange={setBillingInterval}>
                  <SelectTrigger>
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

            <div className="space-y-1">
              <Label>Network</Label>
              {enabledNetworks.length === 0 ? (
                <p className="text-xs text-destructive">
                  No networks enabled. Go to Settings and enable at least one
                  network first.
                </p>
              ) : (
                <Select
                  value={networkKey}
                  onValueChange={(v) => {
                    setNetworkKey(v);
                    setTokenSymbol("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select network" />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledNetworks.map((n) => (
                      <SelectItem key={n.networkKey} value={n.networkKey}>
                        {n.displayLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {networkKey && (
              <div className="space-y-1">
                <Label>Token</Label>
                <Select value={tokenSymbol} onValueChange={setTokenSymbol}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select token" />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledNetworks
                      .find((n) => n.networkKey === networkKey)
                      ?.tokens.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="onb-amount">Amount</Label>
              <Input
                id="onb-amount"
                type="text"
                inputMode="decimal"
                placeholder="10.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-xs text-foreground-muted">
                In token units (e.g. 10.00 USDC).
              </p>
            </div>

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
          <h2 className="text-xl font-semibold">You're all set!</h2>
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
