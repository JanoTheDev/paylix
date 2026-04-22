"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  Section,
  DataTable,
  EmptyState,
  StatusBadge,
  ConfirmDialog,
  col,
} from "@/components/paykit";
import { formatTrialRemaining } from "@/lib/format-trial";

export interface PortalSubscription {
  id: string;
  status: string;
  nextChargeDate: string | null;
  onChainId: string | null;
  productName: string;
  tokenSymbol: string;
  billingInterval: string | null;
  createdAt: string;
  trialEndsAt: string | null;
  trialConversionLastError: string | null;
  productId: string;
  pausedBy?: string | null;
}

function humanizeTrialReason(reason: string | null): string {
  switch (reason) {
    case "insufficient_balance":
      return "Your wallet didn't have enough USDC.";
    case "allowance_revoked":
      return "The USDC allowance was revoked.";
    case "permit_expired":
      return "The authorization signature expired.";
    case "nonce_drift":
      return "Another transaction invalidated the trial signature.";
    default:
      return "An unexpected error occurred.";
  }
}

export interface PortalPayment {
  id: string;
  amount: number;
  refundedCents: number;
  status: string;
  txHash: string | null;
  token: string;
  productName: string;
  createdAt: string;
}

export interface PortalInvoice {
  id: string;
  number: string;
  totalCents: number;
  currency: string;
  issuedAt: string;
  hostedToken: string;
}

export interface PortalWallet {
  id: string;
  address: string;
  nickname: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export interface PortalRefundRequest {
  id: string;
  paymentId: string;
  amount: number;
  reason: string | null;
  status: "pending" | "approved" | "declined" | "expired";
  merchantReason: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface PortalClientProps {
  customerLabel: string;
  customerId: string;
  portalToken: string;
  subscriptions: PortalSubscription[];
  payments: PortalPayment[];
  invoices: PortalInvoice[];
  refundRequests: PortalRefundRequest[];
  wallets: PortalWallet[];
}

type PortalPaymentRow = {
  id: string;
  createdAt: Date;
  productName: string;
  amount: number;
  status: string;
  txHash: string | null;
};

const refundStatusVariant: Record<
  PortalRefundRequest["status"],
  "info" | "success" | "warning" | "default"
> = {
  pending: "info",
  approved: "success",
  declined: "warning",
  expired: "default",
};

const paymentColumns = [
  col.date<PortalPaymentRow>("createdAt", "Date"),
  col.text<PortalPaymentRow>("productName", "Product"),
  col.amount<PortalPaymentRow>("amount", "Amount", { withBadge: true }),
  col.status<PortalPaymentRow>("status", "Status", "payment"),
  col.hash<PortalPaymentRow>("txHash", "Tx"),
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

export function PortalClient({
  customerLabel,
  customerId,
  portalToken,
  subscriptions,
  payments,
  invoices,
  refundRequests,
  wallets,
}: PortalClientProps) {
  const router = useRouter();
  const [cancelTarget, setCancelTarget] = useState<PortalSubscription | null>(
    null,
  );
  const [cancelTrialTarget, setCancelTrialTarget] =
    useState<PortalSubscription | null>(null);
  const [pauseTarget, setPauseTarget] = useState<PortalSubscription | null>(null);
  const [resumeTarget, setResumeTarget] = useState<PortalSubscription | null>(null);
  const [refundTarget, setRefundTarget] = useState<PortalPayment | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [newWalletAddress, setNewWalletAddress] = useState("");
  const [newWalletNickname, setNewWalletNickname] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);

  async function addWallet() {
    if (!/^0x[0-9a-fA-F]{40}$/.test(newWalletAddress.trim())) {
      toast.error("Enter a valid 0x address");
      return;
    }
    setWalletBusy(true);
    try {
      const res = await fetch("/api/portal/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          token: portalToken,
          address: newWalletAddress.trim(),
          nickname: newWalletNickname.trim() || undefined,
        }),
      });
      if (res.ok) {
        toast.success("Wallet added");
        setWalletDialogOpen(false);
        setNewWalletAddress("");
        setNewWalletNickname("");
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error?.message ?? "Add failed");
      }
    } finally {
      setWalletBusy(false);
    }
  }

  async function makePrimary(walletId: string) {
    const res = await fetch(`/api/portal/wallets/${walletId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, token: portalToken }),
    });
    if (res.ok) {
      toast.success("Primary wallet updated");
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error?.message ?? "Update failed");
    }
  }

  async function removeWallet(walletId: string) {
    const res = await fetch(`/api/portal/wallets/${walletId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, token: portalToken }),
    });
    if (res.ok) {
      toast.success("Wallet removed");
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error?.message ?? "Remove failed");
    }
  }

  const openRequestByPayment = new Map<string, PortalRefundRequest>();
  for (const r of refundRequests) {
    if (r.status === "pending" && !openRequestByPayment.has(r.paymentId)) {
      openRequestByPayment.set(r.paymentId, r);
    }
  }

  function startRefund(p: PortalPayment) {
    const remaining = p.amount - p.refundedCents;
    setRefundTarget(p);
    setRefundAmount((remaining / 100).toFixed(2));
    setRefundReason("");
  }

  async function submitRefund() {
    if (!refundTarget) return;
    const dollars = Number(refundAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    const amountCents = Math.round(dollars * 100);
    const remaining = refundTarget.amount - refundTarget.refundedCents;
    if (amountCents > remaining) {
      toast.error("Amount exceeds remaining refundable");
      return;
    }
    setRefundBusy(true);
    try {
      const res = await fetch("/api/portal/refund-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId: refundTarget.id,
          customerId,
          token: portalToken,
          amount: amountCents,
          reason: refundReason.trim() || undefined,
        }),
      });
      if (res.ok) {
        toast.success("Refund requested");
        setRefundTarget(null);
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error?.message ?? "Request failed");
      }
    } finally {
      setRefundBusy(false);
    }
  }

  async function handleConfirmed() {
    // Trigger the server-component refresh and hold the dialog's "Working..."
    // state until the new data has had time to render. The cancel route already
    // waits for the on-chain receipt before returning, so by this point the DB
    // is settled — the small delay just covers the refresh round-trip so the
    // dialog doesn't close while the row still visually says "active".
    router.refresh();
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  const paymentRows: PortalPaymentRow[] = payments.map((p) => ({
    id: p.id,
    createdAt: new Date(p.createdAt),
    productName: p.productName,
    amount: p.amount,
    status: p.status,
    txHash: p.txHash,
  }));

  return (
    <PageShell size="sm">
      <PageHeader
        title="Your Subscriptions & Payments"
        description={`Signed in as ${customerLabel}`}
      />

      <Section title="Subscriptions">
        {subscriptions.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface-1">
            <EmptyState
              title="No subscriptions yet"
              description="You don't have any active subscriptions."
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {subscriptions.map((sub) => {
              const cancelledInPeriod =
                sub.status === "cancelled" &&
                sub.nextChargeDate !== null &&
                new Date(sub.nextChargeDate) > new Date();
              const canCancel =
                sub.status === "active" || sub.status === "past_due";
              const canPause = sub.status === "active";
              const merchantPaused = sub.status === "paused" && sub.pausedBy === "merchant";
              const canResume = sub.status === "paused" && !merchantPaused;
              const isTrialing = sub.status === "trialing";
              const isTrialFailed = sub.status === "trial_conversion_failed";
              return (
                <div
                  key={sub.id}
                  className="flex flex-col gap-4 rounded-lg border border-border bg-surface-1 p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-base font-semibold">
                          {sub.productName}
                        </h3>
                        <StatusBadge
                          kind="subscription"
                          status={
                            (cancelledInPeriod ? "cancelled_in_period" : sub.status) as
                              | "active"
                              | "past_due"
                              | "cancelled"
                              | "cancelled_in_period"
                              | "expired"
                              | "incomplete"
                              | "trialing"
                              | "trial_conversion_failed"
                          }
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-foreground-muted">
                        <span>
                          {cancelledInPeriod ? "Access until:" : "Next charge:"}{" "}
                          <span className="text-foreground">
                            {canCancel || cancelledInPeriod
                              ? formatDate(sub.nextChargeDate)
                              : "—"}
                          </span>
                        </span>
                        {sub.billingInterval && (
                          <span className="capitalize">
                            {sub.billingInterval}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 sm:flex-col sm:items-end">
                      <span className="text-xs font-mono text-foreground-muted">
                        {sub.tokenSymbol}
                      </span>
                      <div className="flex items-center gap-2">
                        {canPause && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPauseTarget(sub)}
                          >
                            Pause
                          </Button>
                        )}
                        {canResume && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setResumeTarget(sub)}
                          >
                            Resume
                          </Button>
                        )}
                        {merchantPaused && (
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled
                            >
                              Paused by merchant
                            </Button>
                            <span className="text-[11px] text-foreground-muted">
                              Contact the merchant to resume.
                            </span>
                          </div>
                        )}
                        {canCancel && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setCancelTarget(sub)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {isTrialing && (
                    <div className="flex flex-col gap-3 rounded-lg border border-info/30 bg-info/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Trial in progress
                        </p>
                        <p className="mt-1 font-mono text-xs text-foreground-muted">
                          Trial {formatTrialRemaining(sub.trialEndsAt)}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCancelTrialTarget(sub)}
                      >
                        Cancel trial
                      </Button>
                    </div>
                  )}

                  {isTrialFailed && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                      <p className="text-sm font-medium text-foreground">
                        We couldn&apos;t start your subscription
                      </p>
                      <p className="mt-1 text-xs text-foreground-muted">
                        Reason: {humanizeTrialReason(sub.trialConversionLastError)}
                      </p>
                      <a
                        href={`/checkout/restart?subscriptionId=${sub.id}`}
                        className="mt-3 inline-block text-sm text-destructive hover:underline"
                      >
                        Restart subscription →
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Payment history">
        <DataTable
          columns={paymentColumns}
          data={paymentRows}
          emptyState={
            <EmptyState
              title="No payments yet"
              description="Your payment history will appear here."
            />
          }
        />
        {payments.some(
          (p) =>
            p.status === "confirmed" &&
            p.amount - p.refundedCents > 0 &&
            !openRequestByPayment.has(p.id),
        ) && (
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <p className="text-xs text-foreground-muted">Need a refund?</p>
            {payments
              .filter(
                (p) =>
                  p.status === "confirmed" &&
                  p.amount - p.refundedCents > 0 &&
                  !openRequestByPayment.has(p.id),
              )
              .map((p) => {
                const remaining = p.amount - p.refundedCents;
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-surface-1 px-4 py-2"
                  >
                    <div className="min-w-0 flex-1 truncate">
                      <span className="text-foreground">{p.productName}</span>
                      <span className="ml-2 font-mono text-xs text-foreground-muted">
                        {(remaining / 100).toFixed(2)} {p.token}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => startRefund(p)}
                    >
                      Request refund
                    </Button>
                  </div>
                );
              })}
          </div>
        )}
      </Section>

      <Section title="Wallets">
        <div className="flex flex-col gap-2">
          {wallets.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-sm text-foreground-muted">
              No wallets on file.
            </div>
          ) : (
            wallets.map((w) => (
              <div
                key={w.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-foreground">
                      {w.address.slice(0, 6)}…{w.address.slice(-4)}
                    </span>
                    {w.isPrimary && <Badge variant="success">Primary</Badge>}
                  </div>
                  {w.nickname && (
                    <p className="mt-1 text-xs text-foreground-muted">
                      {w.nickname}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!w.isPrimary && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => makePrimary(w.id)}
                      >
                        Make primary
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeWallet(w.id)}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWalletDialogOpen(true)}
            >
              Add wallet
            </Button>
          </div>
        </div>
      </Section>

      {refundRequests.length > 0 && (
        <Section title="Refund requests">
          <div className="flex flex-col gap-2">
            {refundRequests.map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-1 rounded-lg border border-border bg-surface-1 px-4 py-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-foreground-muted">
                    {formatDate(r.createdAt)}
                  </span>
                  <span className="font-mono tabular-nums text-foreground">
                    ${(r.amount / 100).toFixed(2)}
                  </span>
                  <Badge variant={refundStatusVariant[r.status]}>
                    {r.status}
                  </Badge>
                </div>
                {r.reason && (
                  <p className="text-xs text-foreground-muted">
                    Your reason: {r.reason}
                  </p>
                )}
                {r.status === "declined" && r.merchantReason && (
                  <p className="text-xs text-warning">
                    Merchant: {r.merchantReason}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Invoices">
        {invoices.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface-1 px-5 py-4 text-sm text-foreground-muted">
            No invoices yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                  <th className="px-4 py-3 font-medium">Number</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium">Issued</th>
                  <th className="px-4 py-3 font-medium text-right">PDF</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-foreground">
                      {inv.number}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground">
                      {formatMoney(inv.totalCents, inv.currency)}
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">
                      {formatDate(inv.issuedAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/i/${inv.hostedToken}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(v) => !v && setCancelTarget(null)}
        title="Cancel subscription?"
        description={
          cancelTarget
            ? `Cancel "${cancelTarget.productName}"? You will not be charged further.`
            : "Cancel this subscription?"
        }
        confirmLabel="Cancel subscription"
        variant="destructive"
        onConfirm={async () => {
          if (!cancelTarget) return;
          const res = await fetch("/api/portal/cancel-subscription", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subscriptionId: cancelTarget.id,
              customerId,
              token: portalToken,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Cancel failed");
          }
          await handleConfirmed();
        }}
      />

      <ConfirmDialog
        open={cancelTrialTarget !== null}
        onOpenChange={(v) => !v && setCancelTrialTarget(null)}
        title="Cancel trial?"
        description={
          cancelTrialTarget
            ? `No charges have been made yet. Cancelling ends the trial for "${cancelTrialTarget.productName}" now.`
            : "Cancel this trial?"
        }
        confirmLabel="Cancel trial"
        variant="destructive"
        onConfirm={async () => {
          if (!cancelTrialTarget) return;
          const res = await fetch("/api/portal/cancel-trial", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subscriptionId: cancelTrialTarget.id,
              customerId,
              token: portalToken,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Cancel trial failed");
          }
          await handleConfirmed();
        }}
      />

      <ConfirmDialog
        open={pauseTarget !== null}
        onOpenChange={(v) => !v && setPauseTarget(null)}
        title="Pause subscription?"
        description={
          pauseTarget
            ? `Pause "${pauseTarget.productName}"? Billing will be paused and your next charge date will shift accordingly.`
            : "Pause this subscription?"
        }
        confirmLabel="Pause subscription"
        onConfirm={async () => {
          if (!pauseTarget) return;
          const res = await fetch("/api/portal/pause-subscription", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subscriptionId: pauseTarget.id,
              customerId,
              token: portalToken,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || "Pause failed");
          }
          await handleConfirmed();
        }}
      />

      <ConfirmDialog
        open={resumeTarget !== null}
        onOpenChange={(v) => !v && setResumeTarget(null)}
        title="Resume subscription?"
        description={
          resumeTarget
            ? `Resume "${resumeTarget.productName}"? Billing will restart and your next charge date will be updated.`
            : "Resume this subscription?"
        }
        confirmLabel="Resume subscription"
        onConfirm={async () => {
          if (!resumeTarget) return;
          const res = await fetch("/api/portal/resume-subscription", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subscriptionId: resumeTarget.id,
              customerId,
              token: portalToken,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || "Resume failed");
          }
          await handleConfirmed();
        }}
      />

      <Dialog
        open={walletDialogOpen}
        onOpenChange={(v) => {
          setWalletDialogOpen(v);
          if (!v) {
            setNewWalletAddress("");
            setNewWalletNickname("");
          }
        }}
      >
        <DialogContent className="border-border bg-surface-1 sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Add a wallet</DialogTitle>
            <DialogDescription>
              Paylix can attempt backup charges against extra wallets
              when the primary runs out of USDC.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1">
              <Label htmlFor="wa-addr">Address</Label>
              <Input
                id="wa-addr"
                value={newWalletAddress}
                onChange={(e) => setNewWalletAddress(e.target.value)}
                placeholder="0x…"
                className="font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="wa-nick">Nickname (optional)</Label>
              <Input
                id="wa-nick"
                value={newWalletNickname}
                onChange={(e) => setNewWalletNickname(e.target.value)}
                placeholder="Backup wallet"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWalletDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addWallet} disabled={walletBusy}>
              {walletBusy ? "Adding…" : "Add wallet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={refundTarget !== null}
        onOpenChange={(v) => !v && setRefundTarget(null)}
      >
        <DialogContent className="border-border bg-surface-1 sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Request a refund</DialogTitle>
            <DialogDescription>
              The merchant will review your request. If approved, the
              refund is sent back to your wallet on-chain.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rf-amount">Amount (USDC)</Label>
              <Input
                id="rf-amount"
                inputMode="decimal"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="font-mono"
              />
              {refundTarget && (
                <p className="text-xs text-foreground-muted">
                  Remaining refundable: $
                  {((refundTarget.amount - refundTarget.refundedCents) / 100).toFixed(
                    2,
                  )}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rf-reason">Reason (optional)</Label>
              <Input
                id="rf-reason"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="What went wrong?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitRefund} disabled={refundBusy}>
              {refundBusy ? "Sending…" : "Submit request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
