"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PageShell,
  PageHeader,
} from "@/components/paykit";
import {
  Shield,
  Key,
  Package,
  Bell,
  Users,
  CreditCard,
  Settings,
  RefreshCw,
  Filter,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface AuditLogEntry {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

const ACTION_META: Record<
  string,
  { label: string; icon: typeof Shield; color: string; badgeVariant: string }
> = {
  "api_key.created": { label: "API key created", icon: Key, color: "text-emerald-400", badgeVariant: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  "api_key.revoked": { label: "API key revoked", icon: Key, color: "text-rose-400", badgeVariant: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  "product.created": { label: "Product created", icon: Package, color: "text-emerald-400", badgeVariant: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  "product.updated": { label: "Product updated", icon: Package, color: "text-sky-400", badgeVariant: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  "webhook.created": { label: "Webhook created", icon: Bell, color: "text-emerald-400", badgeVariant: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  "webhook.updated": { label: "Webhook updated", icon: Bell, color: "text-sky-400", badgeVariant: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  "webhook.deleted": { label: "Webhook deleted", icon: Bell, color: "text-rose-400", badgeVariant: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  "subscription.created": { label: "Subscription started", icon: CreditCard, color: "text-emerald-400", badgeVariant: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  "subscription.renewed": { label: "Subscription renewed", icon: CreditCard, color: "text-sky-400", badgeVariant: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  "subscription.cancelled": { label: "Subscription cancelled", icon: CreditCard, color: "text-rose-400", badgeVariant: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  "subscription.cancelled_onchain": { label: "Cancelled (on-chain)", icon: CreditCard, color: "text-rose-400", badgeVariant: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  "subscription.trial_cancelled": { label: "Trial cancelled", icon: CreditCard, color: "text-amber-400", badgeVariant: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  "subscription.trial_retried": { label: "Trial retried", icon: RefreshCw, color: "text-sky-400", badgeVariant: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  "subscription.trial_converted": { label: "Trial converted", icon: CreditCard, color: "text-emerald-400", badgeVariant: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  "payment.confirmed": { label: "Payment confirmed", icon: CreditCard, color: "text-emerald-400", badgeVariant: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  "customer.deleted": { label: "Customer deleted", icon: Users, color: "text-rose-400", badgeVariant: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  "settings.updated": { label: "Settings updated", icon: Settings, color: "text-sky-400", badgeVariant: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
};

const RESOURCE_FILTERS = [
  { value: "all", label: "All" },
  { value: "subscription", label: "Subscriptions" },
  { value: "payment", label: "Payments" },
  { value: "product", label: "Products" },
  { value: "api_key", label: "API Keys" },
  { value: "webhook", label: "Webhooks" },
  { value: "customer", label: "Customers" },
  { value: "settings", label: "Settings" },
];

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatFullTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [distinctActions, setDistinctActions] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("resourceType", filter);
      if (action) params.set("action", action);
      if (q) params.set("q", q);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to).toISOString());
      const res = await fetch(`/api/settings/audit-log?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs ?? []);
        setDistinctActions(data.distinctActions ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filter, action, q, from, to]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const filteredLogs = logs;

  return (
    <PageShell>
      <PageHeader
        title="Audit Log"
        description="Track every sensitive operation across your organization."
      />

      {/* Resource filter chips */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Filter size={14} className="text-foreground-muted" />
        {RESOURCE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.value
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border bg-transparent text-foreground-muted hover:border-foreground-muted hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Search + action + date range */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex flex-1 min-w-[200px] flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-foreground-muted">
            Search
          </label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Resource ID, email, or details…"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-foreground-muted">
            Action
          </label>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          >
            <option value="">All actions</option>
            {distinctActions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-foreground-muted">
            From
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-foreground-muted">
            To
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        {(q || action || from || to || filter !== "all") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQ("");
              setAction("");
              setFrom("");
              setTo("");
              setFilter("all");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground-muted border-t-transparent" />
          <p className="text-sm text-foreground-muted">Loading audit log...</p>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Shield size={40} className="mb-4 text-foreground-muted" />
          <p className="text-sm font-medium text-foreground">
            {filter === "all" ? "No audit entries yet" : `No ${filter} events`}
          </p>
          <p className="mt-1 max-w-sm text-xs text-foreground-muted">
            Actions like creating API keys, updating products, managing
            subscriptions, and payment confirmations will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {filteredLogs.map((log, idx) => {
            const meta = ACTION_META[log.action] ?? {
              label: log.action,
              icon: Shield,
              color: "text-foreground-muted",
              badgeVariant: "bg-surface-2 text-foreground-muted border-border",
            };
            const Icon = meta.icon;
            const isExpanded = expandedId === log.id;
            const detailName =
              (log.details?.name as string) ??
              (log.details?.url as string) ??
              null;
            const hasDetails =
              Object.keys(log.details ?? {}).length > 0 ||
              log.resourceId ||
              log.ipAddress;

            return (
              <div
                key={log.id}
                className={`${idx > 0 ? "border-t border-border" : ""}`}
              >
                <button
                  type="button"
                  onClick={() =>
                    hasDetails
                      ? setExpandedId(isExpanded ? null : log.id)
                      : undefined
                  }
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                    hasDetails ? "cursor-pointer hover:bg-surface-1" : ""
                  }`}
                >
                  <div
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border ${meta.badgeVariant}`}
                  >
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {meta.label}
                      </span>
                      {detailName && (
                        <span className="truncate text-xs text-foreground-muted">
                          — {detailName}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-foreground-muted">
                      {log.userName ?? (log.userId ? `User ${log.userId.slice(0, 8)}...` : "System")}
                      {" · "}
                      {formatRelativeTime(log.createdAt)}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="flex-shrink-0 text-[10px] uppercase tracking-wider"
                  >
                    {log.resourceType}
                  </Badge>
                </button>

                {isExpanded && (
                  <div className="border-t border-border/50 bg-surface-1/50 px-4 py-3">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs sm:grid-cols-4">
                      <div>
                        <p className="text-foreground-muted">Timestamp</p>
                        <p className="mt-0.5 font-mono text-foreground">
                          {formatFullTime(log.createdAt)}
                        </p>
                      </div>
                      <div>
                        <p className="text-foreground-muted">Action</p>
                        <p className="mt-0.5 font-mono text-foreground">
                          {log.action}
                        </p>
                      </div>
                      {log.resourceId && (
                        <div>
                          <p className="text-foreground-muted">Resource ID</p>
                          <p className="mt-0.5 font-mono text-foreground">
                            {log.resourceId.slice(0, 12)}...
                          </p>
                        </div>
                      )}
                      {log.ipAddress && (
                        <div>
                          <p className="text-foreground-muted">IP Address</p>
                          <p className="mt-0.5 font-mono text-foreground">
                            {log.ipAddress}
                          </p>
                        </div>
                      )}
                      {log.userId && (
                        <div>
                          <p className="text-foreground-muted">User</p>
                          <p className="mt-0.5 text-foreground">
                            {log.userName ?? log.userId.slice(0, 12) + "..."}
                          </p>
                          {log.userEmail && (
                            <p className="font-mono text-foreground-muted">
                              {log.userEmail}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    {Object.keys(log.details ?? {}).length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-foreground-muted">Details</p>
                        <pre className="mt-1 overflow-x-auto rounded-md bg-background p-2 font-mono text-[11px] text-foreground-muted">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && filteredLogs.length > 0 && (
        <p className="mt-4 text-center text-xs text-foreground-muted">
          Showing {filteredLogs.length} of {logs.length} entries (most recent 100)
        </p>
      )}
    </PageShell>
  );
}
