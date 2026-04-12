"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Download, Loader2, Trash2 } from "lucide-react";
import { DetailDrawer, Section, EmptyState, ConfirmDialog } from "@/components/paykit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MetadataEditor } from "@/components/metadata-editor";
import { CancelSubscriptionButton } from "@/components/subscriptions/cancel-subscription-button";
import { TrialActionButton } from "@/components/subscriptions/trial-action-button";
import { formatTrialRemaining } from "@/lib/format-trial";
import { cn } from "@/lib/utils";

interface Props {
  customerId: string | null;
  onOpenChange: (open: boolean) => void;
}

interface CustomerData {
  customer: {
    id: string;
    customerId: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    walletAddress: string | null;
    country: string | null;
    taxId: string | null;
    source: string;
    metadata: Record<string, string> | null;
    createdAt: string;
  };
  payments: Array<{
    id: string;
    amount: number;
    fee: number;
    status: string;
    txHash: string | null;
    createdAt: string;
    productName: string | null;
    productType: string | null;
    metadata: Record<string, string> | null;
  }>;
  subscriptions: Array<{
    id: string;
    status: string;
    createdAt: string;
    nextChargeDate: string | null;
    trialEndsAt: string | null;
    productName: string | null;
    metadata: Record<string, string> | null;
  }>;
  invoices: Array<{
    id: string;
    number: string;
    totalCents: number;
    currency: string;
    issuedAt: string;
    emailStatus: "pending" | "sent" | "failed" | "skipped";
    hostedToken: string;
  }>;
}

function money(cents: number, currency = "USDC") {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

const invoiceStatusVariant: Record<
  "sent" | "pending" | "failed" | "skipped",
  "success" | "info" | "warning" | "destructive"
> = {
  sent: "success",
  pending: "info",
  skipped: "warning",
  failed: "destructive",
};

export function CustomerDetailDrawer({ customerId, onOpenChange }: Props) {
  const router = useRouter();
  const [data, setData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(false);

  // Profile edit state
  const [profileDraft, setProfileDraft] = useState<CustomerData["customer"] | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);

  // Per-payment expanded / metadata edit state
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);
  const [paymentMetadataDraft, setPaymentMetadataDraft] =
    useState<Record<string, Record<string, string>>>({});
  const [savingPaymentId, setSavingPaymentId] = useState<string | null>(null);
  const [paymentSavedId, setPaymentSavedId] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setData(null);
    setProfileDraft(null);
    setProfileError("");
    try {
      const res = await fetch(`/api/customers/${id}`);
      if (!res.ok) {
        setProfileError("Failed to load customer");
        return;
      }
      const json = (await res.json()) as CustomerData;
      setData(json);
      setProfileDraft(json.customer);
      const drafts: Record<string, Record<string, string>> = {};
      for (const p of json.payments) {
        drafts[p.id] = p.metadata ?? {};
      }
      setPaymentMetadataDraft(drafts);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (customerId) {
      load(customerId);
    } else {
      setData(null);
      setProfileDraft(null);
      setExpandedPayment(null);
    }
  }, [customerId, load]);

  async function saveProfile() {
    if (!profileDraft || !data) return;
    setSavingProfile(true);
    setProfileError("");
    setProfileSaved(false);
    try {
      const res = await fetch(`/api/customers/${data.customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: profileDraft.firstName?.trim() || null,
          lastName: profileDraft.lastName?.trim() || null,
          email: profileDraft.email?.trim() || null,
          phone: profileDraft.phone?.trim() || null,
          walletAddress: profileDraft.walletAddress?.trim() || null,
          country: profileDraft.country?.trim() || null,
          taxId: profileDraft.taxId?.trim() || null,
          metadata: profileDraft.metadata ?? {},
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setProfileError(err.error ?? "Failed to save");
        return;
      }
      const json = await res.json();
      setData({ ...data, customer: { ...data.customer, ...json.customer } });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
      router.refresh();
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePaymentMetadata(paymentId: string) {
    setSavingPaymentId(paymentId);
    try {
      const res = await fetch(`/api/payments/${paymentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: paymentMetadataDraft[paymentId] ?? {},
        }),
      });
      if (res.ok && data) {
        setData({
          ...data,
          payments: data.payments.map((p) =>
            p.id === paymentId
              ? { ...p, metadata: paymentMetadataDraft[paymentId] ?? {} }
              : p,
          ),
        });
        setPaymentSavedId(paymentId);
        setTimeout(() => setPaymentSavedId(null), 2000);
      }
    } finally {
      setSavingPaymentId(null);
    }
  }

  function updateProfileField<K extends keyof CustomerData["customer"]>(
    key: K,
    value: CustomerData["customer"][K],
  ) {
    if (!profileDraft) return;
    setProfileDraft({ ...profileDraft, [key]: value });
  }

  async function handleDelete() {
    if (!data) return;
    const res = await fetch(`/api/customers/${data.customer.id}/delete`, {
      method: "POST",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Delete failed");
    }
    onOpenChange(false);
    router.refresh();
  }

  const open = customerId !== null;
  const c = data?.customer;
  const title =
    c?.firstName || c?.lastName
      ? [c.firstName, c.lastName].filter(Boolean).join(" ")
      : c?.email || c?.walletAddress || "Customer";

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={c?.source === "manual" ? "Manually added" : undefined}
      footer={
        profileDraft && (
          <>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete customer
            </Button>
            <div className="flex-1" />
            {profileSaved && (
              <span className="mr-2 text-xs font-medium text-success">
                Saved
              </span>
            )}
            <Button
              size="sm"
              onClick={saveProfile}
              disabled={savingProfile}
            >
              {savingProfile ? "Saving…" : "Save profile"}
            </Button>
          </>
        )
      }
    >
      {loading && (
        <div className="flex h-40 items-center justify-center text-foreground-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {!loading && profileError && !data && (
        <Alert variant="destructive">
          <AlertDescription>{profileError}</AlertDescription>
        </Alert>
      )}

      {!loading && data && profileDraft && (
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
              Profile
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cd-first">First name</Label>
                <Input
                  id="cd-first"
                  value={profileDraft.firstName ?? ""}
                  onChange={(e) => updateProfileField("firstName", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cd-last">Last name</Label>
                <Input
                  id="cd-last"
                  value={profileDraft.lastName ?? ""}
                  onChange={(e) => updateProfileField("lastName", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cd-email">Email</Label>
              <Input
                id="cd-email"
                type="email"
                value={profileDraft.email ?? ""}
                onChange={(e) => updateProfileField("email", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cd-phone">Phone</Label>
              <Input
                id="cd-phone"
                value={profileDraft.phone ?? ""}
                onChange={(e) => updateProfileField("phone", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cd-wallet">Wallet address</Label>
              <Input
                id="cd-wallet"
                value={profileDraft.walletAddress ?? ""}
                onChange={(e) => updateProfileField("walletAddress", e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cd-country">Country</Label>
                <Input
                  id="cd-country"
                  maxLength={2}
                  value={profileDraft.country ?? ""}
                  onChange={(e) =>
                    updateProfileField("country", e.target.value.toUpperCase())
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cd-tax">Tax / VAT ID</Label>
                <Input
                  id="cd-tax"
                  value={profileDraft.taxId ?? ""}
                  onChange={(e) => updateProfileField("taxId", e.target.value)}
                />
              </div>
            </div>
            <MetadataEditor
              value={profileDraft.metadata ?? {}}
              onChange={(next) => updateProfileField("metadata", next)}
              description="Tags attached to this customer, visible via the SDK."
            />
            {profileError && (
              <Alert variant="destructive">
                <AlertDescription>{profileError}</AlertDescription>
              </Alert>
            )}
          </section>

          <Section title={`Purchases (${data.payments.length})`}>
            {data.payments.length === 0 ? (
              <EmptyState
                title="No purchases"
                description="This customer hasn't paid you yet."
              />
            ) : (
              <div className="flex flex-col gap-2">
                {data.payments.map((p) => {
                  const expanded = expandedPayment === p.id;
                  return (
                    <div
                      key={p.id}
                      className="rounded-md border border-border bg-surface-2"
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                        onClick={() =>
                          setExpandedPayment(expanded ? null : p.id)
                        }
                      >
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                        )}
                        <div className="flex flex-1 flex-col text-xs">
                          <span className="font-medium text-foreground">
                            {p.productName ?? "—"}
                          </span>
                          <span className="text-foreground-muted">
                            {new Date(p.createdAt).toLocaleString()}
                          </span>
                        </div>
                        {p.productType === "subscription" && (
                          <Badge variant="info" className="font-normal">
                            Subscription
                          </Badge>
                        )}
                        <span className="font-mono text-sm">
                          {money(p.amount)}
                        </span>
                      </button>
                      {expanded && (
                        <div className="border-t border-border px-3 py-3">
                          {p.txHash && (
                            <div className="mb-3 font-mono text-[11px] text-foreground-muted">
                              <span className="text-foreground-dim">tx</span>{" "}
                              {p.txHash.slice(0, 10)}…{p.txHash.slice(-8)}
                            </div>
                          )}
                          <MetadataEditor
                            value={paymentMetadataDraft[p.id] ?? {}}
                            onChange={(next) =>
                              setPaymentMetadataDraft((prev) => ({
                                ...prev,
                                [p.id]: next,
                              }))
                            }
                            label="Purchase metadata"
                            description="Tags on this specific payment."
                          />
                          <div className="mt-3 flex items-center gap-3">
                            <Button
                              size="sm"
                              onClick={() => savePaymentMetadata(p.id)}
                              disabled={savingPaymentId === p.id}
                            >
                              {savingPaymentId === p.id ? "Saving…" : "Save"}
                            </Button>
                            {paymentSavedId === p.id && (
                              <span className="text-xs font-medium text-success">
                                Saved
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {data.subscriptions.some((s) => s.status === "trialing") && (
            <div className="rounded-lg border border-info/30 bg-info/5 p-3">
              <p className="text-xs font-medium text-foreground">
                Trial in progress
              </p>
              <p className="mt-1 font-mono text-[11px] text-foreground-muted">
                {formatTrialRemaining(
                  data.subscriptions.find((s) => s.status === "trialing")
                    ?.trialEndsAt ?? null,
                )}
              </p>
            </div>
          )}

          <Section title={`Subscriptions (${data.subscriptions.length})`}>
            {data.subscriptions.length === 0 ? (
              <EmptyState
                title="No subscriptions"
                description="No active or past subscriptions for this customer."
              />
            ) : (
              <div className="flex flex-col gap-2">
                {data.subscriptions.map((s) => {
                  const trialing = s.status === "trialing";
                  const trialFailed = s.status === "trial_conversion_failed";
                  return (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5"
                    >
                      <div className="flex flex-1 flex-col text-xs">
                        <span className="font-medium text-foreground">
                          {s.productName ?? "—"}
                        </span>
                        <span className="text-foreground-muted">
                          {trialing ? (
                            <span className="font-mono text-info">
                              {formatTrialRemaining(s.trialEndsAt)}
                            </span>
                          ) : s.nextChargeDate ? (
                            `Next: ${new Date(s.nextChargeDate).toLocaleDateString()}`
                          ) : (
                            `Started ${new Date(s.createdAt).toLocaleDateString()}`
                          )}
                        </span>
                      </div>
                      <Badge
                        variant={
                          trialing
                            ? "info"
                            : trialFailed
                              ? "destructive"
                              : s.status === "active"
                                ? "success"
                                : s.status === "past_due"
                                  ? "warning"
                                  : s.status === "cancelled"
                                    ? "destructive"
                                    : "default"
                        }
                      >
                        {trialing
                          ? "Trial"
                          : trialFailed
                            ? "Trial failed"
                            : s.status}
                      </Badge>
                      {trialing && (
                        <TrialActionButton
                          subscriptionId={s.id}
                          action="cancel"
                          productName={s.productName}
                        />
                      )}
                      {trialFailed && (
                        <TrialActionButton
                          subscriptionId={s.id}
                          action="retry"
                          productName={s.productName}
                        />
                      )}
                      {(s.status === "active" || s.status === "past_due") && (
                        <CancelSubscriptionButton
                          subscriptionId={s.id}
                          productName={s.productName}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title={`Invoices (${data.invoices.length})`}>
            {data.invoices.length === 0 ? (
              <EmptyState
                title="No invoices"
                description="Invoices appear after every successful payment."
              />
            ) : (
              <div className="flex flex-col gap-1.5">
                {data.invoices.map((i) => (
                  <div
                    key={i.id}
                    className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2"
                  >
                    <span className="flex-1 font-mono text-xs">{i.number}</span>
                    <span className="font-mono text-xs text-foreground-muted">
                      {money(i.totalCents, i.currency)}
                    </span>
                    <Badge
                      variant={invoiceStatusVariant[i.emailStatus]}
                      className="text-[10px]"
                    >
                      {i.emailStatus}
                    </Badge>
                    <a
                      href={`/i/${i.hostedToken}/pdf`}
                      className={cn(
                        "inline-flex items-center gap-1 text-[11px] text-accent hover:underline",
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download className="h-3 w-3" /> Invoice
                    </a>
                    <a
                      href={`/i/${i.hostedToken}/receipt`}
                      className="inline-flex items-center gap-1 text-[11px] text-foreground-muted hover:text-foreground"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download className="h-3 w-3" /> Receipt
                    </a>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete customer?"
        description="This will remove the customer from your dashboard. Their payment history is preserved."
        confirmLabel="Delete customer"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </DetailDrawer>
  );
}
