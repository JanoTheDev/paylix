"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const billingIntervals = [
  { value: "minutely", label: "Every Minute (testing)" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 Weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const;

const schema = z
  .object({
    name: z.string().min(1, "Name is required").max(100),
    description: z.string().optional(),
    type: z.enum(["one_time", "subscription"]),
    billingInterval: z
      .enum([
        "minutely",
        "weekly",
        "biweekly",
        "monthly",
        "quarterly",
        "yearly",
      ])
      .optional()
      .or(z.literal("")),
    trialDays: z
      .union([
        z
          .number()
          .int()
          .min(0, "Trial days must be 0 or greater")
          .max(365, "Trial days cannot exceed 365"),
        z.null(),
      ])
      .optional(),
    trialMinutes: z
      .union([
        z
          .number()
          .int()
          .min(0, "Trial minutes must be 0 or greater")
          .max(1440, "Trial minutes cannot exceed 1440"),
        z.null(),
      ])
      .optional(),
    taxRateBps: z
      .union([
        z
          .number()
          .int()
          .min(0, "Tax rate must be 0 or greater")
          .max(10000, "Tax rate cannot exceed 10000 bps (100%)"),
        z.null(),
      ])
      .optional(),
    taxLabel: z
      .string()
      .max(64, "Tax label must be 64 characters or less")
      .nullable()
      .optional(),
    reverseChargeEligible: z.boolean().optional(),
  })
  .refine(
    (d) => d.type !== "subscription" || !!d.billingInterval,
    {
      message: "Billing interval is required for subscriptions",
      path: ["billingInterval"],
    },
  );

export type ProductFormData = {
  id?: string;
  name: string;
  description: string;
  type: "one_time" | "subscription";
  billingInterval:
    | "minutely"
    | "weekly"
    | "biweekly"
    | "monthly"
    | "quarterly"
    | "yearly"
    | "";
  trialDays?: number | null;
  trialMinutes?: number | null;
  metadata: Record<string, string>;
  checkoutFields: {
    firstName: boolean;
    lastName: boolean;
    email: boolean;
    phone: boolean;
  };
  prices: Array<{
    networkKey: string;
    tokenSymbol: string;
    amount: string; // human-readable decimal, converted to native units on save
  }>;
  taxRateBps?: number | null;
  taxLabel?: string | null;
  reverseChargeEligible?: boolean;
};

interface ProductFormProps {
  initialData?: ProductFormData;
  mode: "create" | "edit";
}

export function ProductForm({ initialData, mode }: ProductFormProps) {
  const router = useRouter();
  const [error, setError] = useState("");

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initialData?.name ?? "",
      description: initialData?.description ?? "",
      type: initialData?.type ?? "one_time",
      billingInterval: initialData?.billingInterval ?? "",
      trialDays: initialData?.trialDays ?? null,
      trialMinutes: initialData?.trialMinutes ?? null,
      taxRateBps: initialData?.taxRateBps ?? null,
      taxLabel: initialData?.taxLabel ?? null,
      reverseChargeEligible: initialData?.reverseChargeEligible ?? false,
    },
  });

  const type = form.watch("type");
  const watchedTrialDays = form.watch("trialDays");
  const watchedTrialMinutes = form.watch("trialMinutes");
  const hasTrial =
    type === "subscription" &&
    ((watchedTrialDays ?? 0) > 0 || (watchedTrialMinutes ?? 0) > 0);

  useEffect(() => {
    if (type !== "subscription") {
      form.setValue("billingInterval", "");
      form.setValue("trialDays", null);
      form.setValue("trialMinutes", null);
    }
  }, [type, form]);

  useEffect(() => {
    if (hasTrial) {
      setCheckoutFields((prev) =>
        prev.email ? prev : { ...prev, email: true },
      );
    }
  }, [hasTrial]);

  const [metadataRows, setMetadataRows] = useState<
    { key: string; value: string }[]
  >(
    initialData?.metadata
      ? Object.entries(initialData.metadata).map(([key, value]) => ({
          key,
          value,
        }))
      : [],
  );

  const [checkoutFields, setCheckoutFields] = useState({
    firstName: initialData?.checkoutFields?.firstName ?? false,
    lastName: initialData?.checkoutFields?.lastName ?? false,
    email: initialData?.checkoutFields?.email ?? false,
    phone: initialData?.checkoutFields?.phone ?? false,
  });

  const [prices, setPrices] = useState<
    Array<{ networkKey: string; tokenSymbol: string; amount: string }>
  >(
    initialData?.prices && initialData.prices.length > 0
      ? initialData.prices
      : [{ networkKey: "", tokenSymbol: "", amount: "" }],
  );

  const [enabledNetworks, setEnabledNetworks] = useState<
    Array<{
      networkKey: string;
      chainName: string;
      displayLabel: string;
      tokens: string[];
    }>
  >([]);

  // On create-mode mount, pre-fill the toggles from the merchant's
  // per-account defaults (configured in /settings → Default Checkout Fields).
  // We only do this on create — editing an existing product must show its
  // own saved values, not the account defaults.
  useEffect(() => {
    if (mode !== "create" || initialData) return;
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.checkoutFieldDefaults) return;
        setCheckoutFields({
          firstName: Boolean(data.checkoutFieldDefaults.firstName),
          lastName: Boolean(data.checkoutFieldDefaults.lastName),
          email: Boolean(data.checkoutFieldDefaults.email),
          phone: Boolean(data.checkoutFieldDefaults.phone),
        });
      })
      .catch(() => {
        // If the fetch fails the form just keeps the all-false defaults —
        // merchant can still toggle manually.
      });
    return () => {
      cancelled = true;
    };
  }, [mode, initialData]);

  useEffect(() => {
    // Load merchant's enabled networks from /api/settings
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then(async (data) => {
        if (cancelled || !data?.networks) return;
        const { NETWORKS } = await import("@paylix/config/networks");
        const enabled = data.networks
          .filter((n: { enabled: boolean }) => n.enabled)
          .map((n: { networkKey: string; chainName: string; displayLabel: string }) => ({
            networkKey: n.networkKey,
            chainName: n.chainName,
            displayLabel: n.displayLabel,
            tokens: Object.keys(NETWORKS[n.networkKey as keyof typeof NETWORKS].tokens),
          }));
        if (!cancelled) setEnabledNetworks(enabled);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updatePrice(
    index: number,
    field: "networkKey" | "tokenSymbol" | "amount",
    value: string,
  ) {
    setPrices((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addPrice() {
    setPrices((prev) => [
      ...prev,
      { networkKey: "", tokenSymbol: "", amount: "" },
    ]);
  }

  function removePrice(index: number) {
    setPrices((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function updateMetadataRow(
    index: number,
    field: "key" | "value",
    val: string,
  ) {
    setMetadataRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  }
  function removeMetadataRow(index: number) {
    setMetadataRows((prev) => prev.filter((_, i) => i !== index));
  }
  function addMetadataRow() {
    setMetadataRows((prev) => [...prev, { key: "", value: "" }]);
  }
  function toggleCheckoutField(field: keyof typeof checkoutFields) {
    setCheckoutFields((prev) => ({ ...prev, [field]: !prev[field] }));
  }

  async function onSubmit(values: z.infer<typeof schema>) {
    setError("");

    // Validate all prices have complete fields
    for (const p of prices) {
      if (!p.networkKey || !p.tokenSymbol || !p.amount.trim()) {
        setError("All price entries must have network, token, and amount set");
        return;
      }
    }

    // Convert amounts to native units
    const { NETWORKS } = await import("@paylix/config/networks");
    const { toNativeUnits } = await import("@/lib/amounts");

    let convertedPrices: Array<{
      networkKey: string;
      tokenSymbol: string;
      amount: string;
    }>;
    try {
      convertedPrices = prices.map((p) => {
        const network = NETWORKS[p.networkKey as keyof typeof NETWORKS];
        const token = (network.tokens as Record<string, typeof network.tokens[keyof typeof network.tokens]>)[p.tokenSymbol];
        if (!token) {
          throw new Error(`Unknown token ${p.tokenSymbol} on ${p.networkKey}`);
        }
        return {
          networkKey: p.networkKey,
          tokenSymbol: p.tokenSymbol,
          amount: toNativeUnits(p.amount, token.decimals).toString(),
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Price conversion error");
      return;
    }

    const metadata: Record<string, string> = {};
    for (const row of metadataRows) {
      if (row.key.trim()) metadata[row.key.trim()] = row.value;
    }

    const payload: Record<string, unknown> = {
      name: values.name,
      description: values.description || undefined,
      type: values.type,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      checkoutFields,
      prices: convertedPrices,
      taxRateBps: values.taxRateBps ?? null,
      taxLabel: values.taxLabel ?? null,
      reverseChargeEligible: Boolean(values.reverseChargeEligible),
    };
    if (values.type === "subscription" && values.billingInterval) {
      payload.billingInterval = values.billingInterval;
    }
    payload.trialDays =
      values.type === "subscription" && values.trialDays
        ? values.trialDays
        : null;
    payload.trialMinutes =
      values.type === "subscription" && values.trialMinutes
        ? values.trialMinutes
        : null;

    try {
      const url =
        mode === "edit" ? `/api/products/${initialData?.id}` : "/api/products";
      const method = mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = body.error ?? "Something went wrong";
        setError(message);
        toast.error(
          mode === "edit" ? "Failed to save product" : "Failed to create product",
        );
        return;
      }
      toast.success(mode === "edit" ? "Product saved" : "Product created");
      router.push("/products");
      router.refresh();
    } catch {
      setError("Network error");
      toast.error(
        mode === "edit" ? "Failed to save product" : "Failed to create product",
      );
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="max-w-[640px] space-y-6"
      >
        <Card>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="My Product" maxLength={100} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional description..."
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="one_time">One-time</SelectItem>
                      <SelectItem value="subscription">Subscription</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {type === "subscription" && (
              <FormField
                control={form.control}
                name="billingInterval"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Billing Interval</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value ?? ""}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select interval" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {billingIntervals.map((i) => (
                          <SelectItem key={i.value} value={i.value}>
                            {i.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {type === "subscription" && (
              <FormField
                control={form.control}
                name="trialDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Trial period (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        step={1}
                        placeholder="0"
                        className="font-mono"
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          field.onChange(v === "" ? null : Number(v));
                        }}
                      />
                    </FormControl>
                    <p className="text-xs text-foreground-muted">
                      Customers start the trial without being charged. First
                      charge happens automatically when the trial ends.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {type === "subscription" && (
              <FormField
                control={form.control}
                name="trialMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Trial minutes (testing)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={1440}
                        step={1}
                        placeholder="0"
                        className="font-mono"
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          field.onChange(v === "" ? null : Number(v));
                        }}
                      />
                    </FormControl>
                    <p className="text-xs text-foreground-muted">
                      For testing only — overrides trial days when set. The
                      trial converts after this many minutes instead.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Prices</h3>
              <p className="text-xs text-muted-foreground">
                One or more prices per product. Each entry is an independent
                (network, token, amount) combination. Buyers pick between them at
                checkout if you don&apos;t pre-lock the currency.
              </p>
            </div>

            {enabledNetworks.length === 0 ? (
              <Alert variant="destructive">
                <AlertDescription>
                  No networks enabled. Go to Settings → Networks and enable at
                  least one before creating a product.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                {prices.map((p, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end"
                  >
                    <div>
                      <Label className="text-xs">Network</Label>
                      <select
                        value={p.networkKey}
                        onChange={(e) =>
                          updatePrice(i, "networkKey", e.target.value)
                        }
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Select network…</option>
                        {enabledNetworks.map((n) => (
                          <option key={n.networkKey} value={n.networkKey}>
                            {n.displayLabel}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <Label className="text-xs">Token</Label>
                      <select
                        value={p.tokenSymbol}
                        onChange={(e) =>
                          updatePrice(i, "tokenSymbol", e.target.value)
                        }
                        disabled={!p.networkKey}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
                      >
                        <option value="">Select token…</option>
                        {p.networkKey &&
                          enabledNetworks
                            .find((n) => n.networkKey === p.networkKey)
                            ?.tokens.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                      </select>
                    </div>

                    <div>
                      <Label className="text-xs">Amount</Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="10.00"
                        value={p.amount}
                        onChange={(e) => updatePrice(i, "amount", e.target.value)}
                      />
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removePrice(i)}
                      disabled={prices.length === 1}
                      aria-label="Remove price"
                    >
                      <Trash2 size={16} strokeWidth={1.5} />
                    </Button>
                  </div>
                ))}

                <Button type="button" variant="ghost" size="sm" onClick={addPrice}>
                  <Plus size={16} strokeWidth={1.5} />
                  Add price
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Metadata</h3>
              <p className="text-xs text-muted-foreground">
                Custom key-value data attached to the product.
              </p>
            </div>
            <div className="space-y-2">
              {metadataRows.map((row, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center"
                >
                  <Input
                    placeholder="key"
                    value={row.key}
                    onChange={(e) =>
                      updateMetadataRow(i, "key", e.target.value)
                    }
                    className="sm:w-[40%]"
                  />
                  <Input
                    placeholder="value"
                    value={row.value}
                    onChange={(e) =>
                      updateMetadataRow(i, "value", e.target.value)
                    }
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeMetadataRow(i)}
                    className="self-end sm:self-auto"
                    aria-label="Remove field"
                  >
                    <Trash2 size={16} strokeWidth={1.5} />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addMetadataRow}
            >
              <Plus size={16} strokeWidth={1.5} />
              Add field
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Tax</h3>
              <p className="text-xs text-muted-foreground">
                Optional. Applied to invoices issued for this product. Rate is
                in basis points — e.g. 2000 = 20%.
              </p>
            </div>

            <FormField
              control={form.control}
              name="taxRateBps"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tax rate (bps)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={10000}
                      step={1}
                      placeholder="2000"
                      value={field.value ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        field.onChange(v === "" ? null : Number(v));
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="taxLabel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tax label</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      maxLength={64}
                      placeholder="VAT"
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(e.target.value === "" ? null : e.target.value)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reverseChargeEligible"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel className="mb-0">
                      Reverse charge eligible
                    </FormLabel>
                    <Switch
                      checked={Boolean(field.value)}
                      onCheckedChange={field.onChange}
                    />
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Checkout Fields</h3>
              <p className="text-xs text-muted-foreground">
                Collect these from customers at checkout.
              </p>
            </div>
            <Separator />
            <div className="space-y-3">
              <ToggleRow
                label="First Name"
                checked={checkoutFields.firstName}
                onToggle={() => toggleCheckoutField("firstName")}
              />
              <ToggleRow
                label="Last Name"
                checked={checkoutFields.lastName}
                onToggle={() => toggleCheckoutField("lastName")}
              />
              <ToggleRow
                label="Email"
                checked={hasTrial || checkoutFields.email}
                onToggle={() => toggleCheckoutField("email")}
                disabled={hasTrial}
                helper={
                  hasTrial
                    ? "Required for trial-enabled products"
                    : undefined
                }
              />
              <ToggleRow
                label="Phone"
                checked={checkoutFields.phone}
                onToggle={() => toggleCheckoutField("phone")}
              />
            </div>
          </CardContent>
        </Card>

        <Button
          type="submit"
          size="xl"
          disabled={form.formState.isSubmitting}
          className="sm:w-auto sm:px-6"
        >
          {form.formState.isSubmitting
            ? "Saving..."
            : mode === "edit"
              ? "Update Product"
              : "Create Product"}
        </Button>
      </form>
    </Form>
  );
}

function ToggleRow({
  label,
  checked,
  onToggle,
  disabled,
  helper,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  helper?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm">{label}</span>
        <Switch
          checked={checked}
          onCheckedChange={onToggle}
          disabled={disabled}
        />
      </div>
      {helper && (
        <p className="text-xs text-muted-foreground">{helper}</p>
      )}
    </div>
  );
}
