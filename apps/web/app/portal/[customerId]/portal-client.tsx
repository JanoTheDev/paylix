"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CancelSubscriptionModal from "@/components/cancel-subscription-modal";

export interface PortalSubscription {
  id: string;
  status: string;
  nextChargeDate: string | null;
  onChainId: string | null;
  productName: string;
  productPrice: number;
  productCurrency: string;
  billingInterval: string | null;
  createdAt: string;
}

export interface PortalPayment {
  id: string;
  amount: number;
  status: string;
  txHash: string | null;
  token: string;
  productName: string;
  createdAt: string;
}

interface PortalClientProps {
  customerLabel: string;
  subscriptions: PortalSubscription[];
  payments: PortalPayment[];
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncateHash(h: string): string {
  if (h.length <= 13) return h;
  return `${h.slice(0, 6)}...${h.slice(-4)}`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; border: string; label: string }> = {
    active: { bg: "#22c55e12", text: "#22c55e", border: "#22c55e30", label: "Active" },
    confirmed: { bg: "#22c55e12", text: "#22c55e", border: "#22c55e30", label: "Confirmed" },
    past_due: { bg: "#fbbf2412", text: "#fbbf24", border: "#fbbf2430", label: "Past Due" },
    pending: { bg: "#60a5fa12", text: "#60a5fa", border: "#60a5fa30", label: "Pending" },
    cancelled: { bg: "#f8717112", text: "#f87171", border: "#f8717130", label: "Cancelled" },
    expired: { bg: "#f8717112", text: "#f87171", border: "#f8717130", label: "Expired" },
    failed: { bg: "#f8717112", text: "#f87171", border: "#f8717130", label: "Failed" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span
      className="inline-block rounded-full px-2.5 py-[3px] text-[11px] font-semibold leading-none tracking-[0.3px]"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {s.label}
    </span>
  );
}

export function PortalClient({
  customerLabel,
  subscriptions,
  payments,
}: PortalClientProps) {
  const router = useRouter();
  const [cancelTarget, setCancelTarget] = useState<PortalSubscription | null>(null);

  function handleConfirmed() {
    setTimeout(() => router.refresh(), 2500);
  }

  return (
    <div>
      <div className="mb-10">
        <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.6px] text-[#f0f0f3]">
          Your Subscriptions & Payments
        </h1>
        <p className="mt-2 text-[14px] leading-[1.55] text-[#94a3b8]">
          Signed in as {customerLabel}
        </p>
      </div>

      {/* Subscriptions card */}
      <section className="mb-8 rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116] p-6">
        <div className="mb-5">
          <h2 className="text-[20px] font-semibold leading-[1.25] tracking-[-0.4px] text-[#f0f0f3]">
            Subscriptions
          </h2>
        </div>

        {subscriptions.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[#64748b]">
            You don&apos;t have any subscriptions yet.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {subscriptions.map((sub) => {
              const canCancel = sub.status === "active" || sub.status === "past_due";
              return (
                <div
                  key={sub.id}
                  className="flex flex-col gap-4 rounded-lg border border-[rgba(148,163,184,0.12)] bg-[#07070a] p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-[16px] font-medium text-[#f0f0f3]">
                        {sub.productName}
                      </h3>
                      <StatusBadge status={sub.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-[#94a3b8]">
                      <span>
                        Next charge:{" "}
                        <span className="text-[#f0f0f3]">
                          {canCancel ? formatDate(sub.nextChargeDate) : "—"}
                        </span>
                      </span>
                      {sub.billingInterval && (
                        <span className="capitalize">{sub.billingInterval}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 sm:flex-col sm:items-end">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-[18px] font-semibold text-[#f0f0f3]"
                        style={{
                          fontFamily: '"Geist Mono", ui-monospace, monospace',
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        ${formatAmount(sub.productPrice)}
                      </span>
                      <span
                        className="inline-flex items-center rounded-[6px] border border-[#2775ca33] bg-[#2775ca14] px-[8px] py-[2px] text-[11px] font-semibold tracking-[0.3px] text-[#2775ca]"
                        style={{ fontFamily: '"Geist Mono", ui-monospace, monospace' }}
                      >
                        {sub.productCurrency}
                      </span>
                    </div>
                    {canCancel && (
                      <button
                        onClick={() => setCancelTarget(sub)}
                        className="inline-flex items-center rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors"
                        style={{
                          background: "transparent",
                          borderColor: "#f8717130",
                          color: "#f87171",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#f8717112";
                          e.currentTarget.style.borderColor = "#f8717150";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.borderColor = "#f8717130";
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Payment history */}
      <section className="rounded-xl border border-[rgba(148,163,184,0.12)] bg-[#111116]">
        <div className="p-6 pb-0">
          <h2 className="text-[20px] font-semibold leading-[1.25] tracking-[-0.4px] text-[#f0f0f3]">
            Payment history
          </h2>
        </div>

        {payments.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-[#64748b]">
            No payments yet.
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(148,163,184,0.08)]">
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Date
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Product
                  </th>
                  <th className="h-10 px-4 text-right text-[13px] font-medium text-[#64748b]">
                    Amount
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Status
                  </th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-[#64748b]">
                    Tx
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-[rgba(148,163,184,0.06)] transition-colors hover:bg-[#0c0c10]"
                  >
                    <td className="h-[52px] px-4 text-[13px] text-[#94a3b8]">
                      {formatDate(p.createdAt)}
                    </td>
                    <td className="h-[52px] px-4 text-[13px] text-[#f0f0f3]">
                      {p.productName}
                    </td>
                    <td
                      className="h-[52px] px-4 text-right text-[13px] font-medium text-[#f0f0f3]"
                      style={{
                        fontFamily: '"Geist Mono", ui-monospace, monospace',
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      ${formatAmount(p.amount)} {p.token}
                    </td>
                    <td className="h-[52px] px-4">
                      <StatusBadge status={p.status} />
                    </td>
                    <td
                      className="h-[52px] px-4 text-[13px] text-[#94a3b8]"
                      style={{ fontFamily: '"Geist Mono", ui-monospace, monospace' }}
                    >
                      {p.txHash ? truncateHash(p.txHash) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CancelSubscriptionModal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        onChainId={cancelTarget?.onChainId ?? null}
        productName={cancelTarget?.productName ?? null}
        onConfirmed={handleConfirmed}
      />
    </div>
  );
}
