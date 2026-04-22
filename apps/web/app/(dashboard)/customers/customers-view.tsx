"use client";

import { useMemo, useState } from "react";
import {
  PageShell,
  PageHeader,
  DataTable,
  EmptyState,
  ExportButton,
  col,
} from "@/components/paykit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import PortalLinkButton from "./portal-link-button";
import { CreateCustomerSheet } from "@/components/customers/create-customer-sheet";
import { CustomerDetailDrawer } from "@/components/customers/customer-detail-drawer";

export type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  walletAddress: string | null;
  source: string;
  totalSpent: number;
  paymentCount: number;
  lastPayment: Date | null;
  activeSubscriptionCount: number;
  hasPastDue: boolean;
  hasActiveTrial: boolean;
};

type Segment = "all" | "subscribers" | "one-time" | "past-due";

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "all", label: "All" },
  { key: "subscribers", label: "Active subscribers" },
  { key: "one-time", label: "One-time" },
  { key: "past-due", label: "Past due" },
];

const columns = [
  col.text<CustomerRow>("name", "Name"),
  col.text<CustomerRow>("email", "Email"),
  col.address<CustomerRow>("walletAddress", "Wallet"),
  col.amount<CustomerRow>("totalSpent", "Total Spent"),
  col.text<CustomerRow>("paymentCount", "Payments", { align: "right" }),
  col.date<CustomerRow>("lastPayment", "Last Payment"),
  col.actions<CustomerRow>((row) => (
    <div
      className="flex items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      {row.activeSubscriptionCount > 0 && (
        <Badge variant="success">Subscriber</Badge>
      )}
      {row.hasActiveTrial && <Badge variant="info">Trial</Badge>}
      {row.hasPastDue && <Badge variant="warning">Past due</Badge>}
      {row.source === "manual" && <Badge variant="info">Manual</Badge>}
      <PortalLinkButton customerUuid={row.id} />
    </div>
  )),
];

interface CustomersViewProps {
  rows: CustomerRow[];
}

export default function CustomersView({ rows }: CustomersViewProps) {
  const [segment, setSegment] = useState<Segment>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    switch (segment) {
      case "subscribers":
        return rows.filter((r) => r.activeSubscriptionCount > 0);
      case "one-time":
        return rows.filter(
          (r) => r.activeSubscriptionCount === 0 && r.paymentCount > 0,
        );
      case "past-due":
        return rows.filter((r) => r.hasPastDue);
      default:
        return rows;
    }
  }, [rows, segment]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      subscribers: rows.filter((r) => r.activeSubscriptionCount > 0).length,
      "one-time": rows.filter(
        (r) => r.activeSubscriptionCount === 0 && r.paymentCount > 0,
      ).length,
      "past-due": rows.filter((r) => r.hasPastDue).length,
    }),
    [rows],
  );

  return (
    <PageShell>
      <PageHeader
        title="Customers"
        description="Everyone who has paid you or been added manually."
        action={
          <div className="flex gap-2">
            <ExportButton href="/api/customers/export" />
            <Button onClick={() => setCreateOpen(true)}>+ New customer</Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {SEGMENTS.map((s) => {
          const active = segment === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setSegment(s.key)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border bg-transparent text-foreground-muted hover:border-border-strong hover:text-foreground",
              )}
            >
              {s.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0 font-mono text-[10px] tabular-nums",
                  active
                    ? "bg-accent/20 text-foreground"
                    : "bg-surface-2 text-foreground-muted",
                )}
              >
                {counts[s.key]}
              </span>
            </button>
          );
        })}
      </div>
      <DataTable
        columns={columns}
        data={filtered}
        onRowClick={(row) => setDetailId(row.id)}
        emptyState={
          <EmptyState
            title={segment === "all" ? "No customers yet" : "No matches"}
            description={
              segment === "all"
                ? "Once someone pays you, they'll appear here. You can also add one manually."
                : "No customers match this filter."
            }
          />
        }
      />
      <CreateCustomerSheet open={createOpen} onOpenChange={setCreateOpen} />
      <CustomerDetailDrawer
        customerId={detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      />
    </PageShell>
  );
}
