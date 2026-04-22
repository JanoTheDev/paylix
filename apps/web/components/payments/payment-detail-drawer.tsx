"use client";

import { useEffect, useState } from "react";
import {
  DetailDrawer,
  Section,
  KeyValueList,
} from "@/components/paykit";
import { Badge } from "@/components/ui/badge";

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

export function PaymentDetailDrawer({ paymentId, onClose }: Props) {
  const [data, setData] = useState<Composite | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!paymentId) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/payments/${paymentId}/detail`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setData(json))
      .finally(() => setLoading(false));
  }, [paymentId]);

  const open = paymentId !== null;
  const p = data?.payment;

  return (
    <DetailDrawer
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={p ? `Payment ${p.id.slice(0, 8)}…` : "Payment"}
      description={
        p ? `${(p.amount / 100).toFixed(2)} ${p.token} — ${p.status}` : undefined
      }
    >
      {loading && !data ? (
        <div className="py-8 text-center text-sm text-foreground-muted">
          Loading…
        </div>
      ) : p ? (
        <div className="flex flex-col gap-6">
          <Section title="Details">
            <KeyValueList
              items={[
                { label: "Amount", value: `$${(p.amount / 100).toFixed(2)} ${p.token}`, mono: true },
                { label: "Fee", value: `$${(p.fee / 100).toFixed(2)}`, mono: true },
                { label: "Quantity", value: String(p.quantity) },
                { label: "Status", value: p.status },
                { label: "Chain", value: p.chain, mono: true },
                { label: "Created", value: new Date(p.createdAt).toLocaleString() },
                {
                  label: "Tx hash",
                  value: p.txHash ?? "—",
                  mono: true,
                },
                {
                  label: "Block",
                  value: p.blockNumber !== null ? String(p.blockNumber) : "—",
                  mono: true,
                },
                { label: "From", value: p.fromAddress ?? "—", mono: true },
                { label: "To", value: p.toAddress ?? "—", mono: true },
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
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    Hosted
                  </a>
                  <a
                    href={`/i/${p.invoiceHostedToken}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline-offset-2 hover:underline"
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
                      <span className="font-mono">
                        ${(r.amount / 100).toFixed(2)}
                      </span>
                      <Badge variant="warning">{r.status}</Badge>
                    </div>
                    {r.reason && (
                      <p className="mt-1 text-xs text-foreground-muted">
                        {r.reason}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[11px] text-foreground-dim">
                      {r.txHash.slice(0, 14)}… ·{" "}
                      {new Date(r.createdAt).toLocaleString()}
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
                    <span className="text-[11px] text-foreground-dim">
                      {d.status} · {d.httpStatus ?? "—"}
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
