"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AddressText,
  Amount,
  DetailDrawer,
  ErrorState,
  HashText,
  KeyValueList,
  LoadingState,
  Section,
  StatusBadge,
} from "@/components/paykit";
import { Badge } from "@/components/ui/badge";
import { formatAmount } from "@/lib/format";

interface PaymentDetail {
  id: string;
  amount: number;
  fee: number;
  status: string;
  txHash: string | null;
  chain: string;
  token: string;
  fromAddress: string | null;
  toAddress: string | null;
  blockNumber: number | null;
  metadata: Record<string, string> | null;
  refundedCents: number;
  refundedAt: string | null;
  quantity: number;
  createdAt: string;
  productName: string | null;
  customerExternalId: string | null;
  customerEmail: string | null;
  invoiceNumber: string | null;
  invoiceHostedToken: string | null;
}

interface RefundRow {
  id: string;
  amount: number;
  reason: string | null;
  txHash: string;
  status: string;
  createdAt: string;
}

interface DeliveryRow {
  id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  httpStatus: number | null;
  attempts: number;
  createdAt: string;
}

interface Composite {
  payment: PaymentDetail;
  refunds: RefundRow[];
  webhookDeliveries: DeliveryRow[];
  checkoutSession: { id: string; status: string } | null;
}

interface Props {
  paymentId: string | null;
  onClose: () => void;
}

const REFUND_STATUS_VARIANT: Record<string, "success" | "warning" | "destructive"> =
  {
    completed: "success",
    confirmed: "success",
    pending: "warning",
    failed: "destructive",
  };

export function PaymentDetailDrawer({ paymentId, onClose }: Props) {
  const [data, setData] = useState<Composite | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Every request — the initial load and every retry — is issued through
  // `start`, which owns the single in-flight slot. Bumping `requestId`
  // invalidates whatever is outstanding, so closing the drawer or switching
  // payments can never let a late response paint the wrong payment.
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback((id: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const myId = ++requestId.current;
    const isStale = () => myId !== requestId.current;

    void (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/payments/${id}/detail`, {
          signal: controller.signal,
        });
        if (isStale()) return;
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as Composite;
        if (isStale()) return;
        setData(json);
      } catch (err) {
        if (isStale()) return;
        setData(null);
        setError(
          err instanceof Error
            ? `Couldn't load this payment: ${err.message}`
            : "Couldn't load this payment.",
        );
      } finally {
        if (!isStale()) setLoading(false);
      }
    })();
  }, []);

  /** Invalidates and aborts anything in flight. */
  const cancelInFlight = useCallback(() => {
    requestId.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    if (!paymentId) {
      cancelInFlight();
      setData(null);
      setError("");
      setLoading(false);
      return;
    }
    start(paymentId);
    return cancelInFlight;
  }, [paymentId, start, cancelInFlight]);

  function retry() {
    if (!paymentId) return;
    start(paymentId);
  }

  const open = paymentId !== null;
  const p = data?.payment;
  // The drawer only ever reflects the status the API returned for this
  // payment — nothing here infers "confirmed" from client-side state.
  const paymentStatus =
    p?.status === "confirmed" || p?.status === "failed" ? p.status : "pending";

  return (
    <DetailDrawer
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={p ? `Payment ${p.id.slice(0, 8)}…` : "Payment"}
      description={
        p ? `${formatAmount(p.amount)} ${p.token} — ${p.status}` : undefined
      }
    >
      {loading && !data ? (
        <LoadingState variant="detail" />
      ) : error ? (
        <ErrorState
          title="Couldn't load this payment"
          description={error}
          onRetry={retry}
        />
      ) : p ? (
        <div className="flex flex-col gap-6">
          <Section title="Details">
            <KeyValueList
              items={[
                {
                  label: "Amount",
                  value: <Amount cents={p.amount} withBadge symbol={p.token} />,
                },
                { label: "Fee", value: formatAmount(p.fee), mono: true },
                { label: "Quantity", value: String(p.quantity), mono: true },
                {
                  label: "Status",
                  value: <StatusBadge kind="payment" status={paymentStatus} />,
                },
                { label: "Chain", value: p.chain, mono: true },
                {
                  label: "Created",
                  value: new Date(p.createdAt).toLocaleString(),
                },
                {
                  label: "Tx hash",
                  value: p.txHash ? (
                    <HashText hash={p.txHash} networkKey={p.chain} />
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Block",
                  value: p.blockNumber !== null ? String(p.blockNumber) : "—",
                  mono: true,
                },
                {
                  label: "From",
                  value: p.fromAddress ? (
                    <AddressText address={p.fromAddress} link networkKey={p.chain} />
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "To",
                  value: p.toAddress ? (
                    <AddressText address={p.toAddress} link networkKey={p.chain} />
                  ) : (
                    "—"
                  ),
                },
              ]}
            />
          </Section>

          {(p.customerEmail || p.customerExternalId) && (
            <Section title="Customer">
              <KeyValueList
                items={[
                  { label: "Customer ID", value: p.customerExternalId ?? "—", mono: true },
                  { label: "Email", value: p.customerEmail ?? "—" },
                  { label: "Product", value: p.productName ?? "—" },
                ]}
              />
            </Section>
          )}

          {p.invoiceNumber && p.invoiceHostedToken && (
            <Section title="Invoice">
              <div className="flex items-center justify-between text-sm">
                <span className="font-mono text-foreground">{p.invoiceNumber}</span>
                <div className="flex gap-3 text-xs">
                  <a
                    href={`/i/${p.invoiceHostedToken}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    Hosted
                  </a>
                  <a
                    href={`/i/${p.invoiceHostedToken}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    PDF
                  </a>
                </div>
              </div>
            </Section>
          )}

          <Section
            title={`Refunds (${data?.refunds.length ?? 0})`}
          >
            {data?.refunds.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {data.refunds.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-md border border-border bg-surface-2 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono tabular-nums">
                        {formatAmount(r.amount)}
                      </span>
                      <Badge
                        variant={REFUND_STATUS_VARIANT[r.status] ?? "secondary"}
                      >
                        {r.status}
                      </Badge>
                    </div>
                    {r.reason && (
                      <p className="mt-1 text-xs text-foreground-muted">
                        {r.reason}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-foreground-dim">
                      <HashText
                        hash={r.txHash}
                        networkKey={p.chain}
                        className="text-[11px] text-foreground-dim"
                      />{" "}
                      · {new Date(r.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-foreground-muted">No refunds yet.</p>
            )}
          </Section>

          <Section
            title={`Webhook deliveries (${data?.webhookDeliveries.length ?? 0})`}
          >
            {data?.webhookDeliveries.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {data.webhookDeliveries.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2"
                  >
                    <span className="font-mono text-xs">{d.event}</span>
                    <span className="flex items-center gap-2 text-[11px] text-foreground-dim">
                      <StatusBadge kind="delivery" status={d.status} />
                      <span className="font-mono tabular-nums">
                        {d.httpStatus ?? "—"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-foreground-muted">
                No related deliveries.
              </p>
            )}
          </Section>

          {p.metadata && Object.keys(p.metadata).length > 0 && (
            <Section title="Metadata">
              <KeyValueList
                items={Object.entries(p.metadata).map(([k, v]) => ({
                  label: k,
                  value: String(v),
                  mono: true,
                }))}
              />
            </Section>
          )}
        </div>
      ) : null}
    </DetailDrawer>
  );
}
