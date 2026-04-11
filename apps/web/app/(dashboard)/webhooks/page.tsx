"use client";

import { useCallback, useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  DataTable,
  EmptyState,
  ConfirmDialog,
  DetailDrawer,
  KeyValueList,
  Section,
  col,
} from "@/components/paykit";
import { CopyableField } from "@/components/paykit/copyable-field";

interface WebhookDelivery {
  id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  httpStatus: number | null;
  attempts: number;
  createdAt: string;
}

interface Webhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
  raw: Webhook;
};

type DeliveryRow = {
  id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  httpStatus: number | null;
  attempts: number;
  createdAt: Date;
};

const ALL_EVENTS: { value: string; label: string }[] = [
  { value: "payment.confirmed", label: "Payment confirmed" },
  { value: "subscription.created", label: "Subscription created" },
  { value: "subscription.charged", label: "Subscription charged" },
  { value: "subscription.past_due", label: "Subscription past due" },
  { value: "subscription.cancelled", label: "Subscription cancelled" },
  { value: "invoice.issued", label: "Invoice issued" },
  { value: "invoice.email_sent", label: "Invoice email sent" },
  { value: "invoice.email_failed", label: "Invoice email failed" },
];

const deliveryColumns: ColumnDef<DeliveryRow, unknown>[] = [
  col.text<DeliveryRow>("event", "Event"),
  col.status<DeliveryRow>("status", "Status", "delivery"),
  col.text<DeliveryRow>("httpStatus", "HTTP", { align: "right" }),
  col.text<DeliveryRow>("attempts", "Attempts", { align: "right" }),
  col.dateTime<DeliveryRow>("createdAt", "Timestamp"),
];

export default function WebhooksPage() {
  const [webhookList, setWebhookList] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Webhook | null>(null);
  const [selectedSecret, setSelectedSecret] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [testing, setTesting] = useState(false);

  const fetchWebhooks = useCallback(async () => {
    const res = await fetch("/api/webhooks");
    if (res.ok) setWebhookList(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  async function handleCreate() {
    if (!newUrl.trim() || newEvents.length === 0) return;
    setCreating(true);
    const res = await fetch("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: newUrl, events: newEvents }),
    });
    if (res.ok) {
      const created = await res.json();
      setCreatedSecret(created.secret ?? null);
      setNewUrl("");
      setNewEvents([]);
      fetchWebhooks();
    }
    setCreating(false);
  }

  function closeCreateDialog() {
    setCreateOpen(false);
    setCreatedSecret(null);
    setNewUrl("");
    setNewEvents([]);
  }

  async function handleToggle(id: string, active: boolean) {
    await fetch(`/api/webhooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: active }),
    });
    fetchWebhooks();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
    if (res.ok) {
      setDeleteId(null);
      setSelected(null);
      fetchWebhooks();
    }
  }

  async function handleTest() {
    if (!selected) return;
    setTesting(true);
    const res = await fetch(`/api/webhooks/${selected.id}/test`, {
      method: "POST",
    });
    if (res.ok) {
      const delivery = await res.json();
      setDeliveries((prev) => [delivery, ...prev]);
    }
    setTesting(false);
  }

  function toggleEvent(event: string) {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  const rows: WebhookRow[] = webhookList.map((w) => ({
    id: w.id,
    url: w.url,
    events: w.events,
    isActive: w.isActive,
    createdAt: new Date(w.createdAt),
    raw: w,
  }));

  const columns: ColumnDef<WebhookRow, unknown>[] = [
    col.mono<WebhookRow>("url", "URL"),
    {
      accessorKey: "events",
      header: "Events",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.events.map((e) => (
            <Badge key={e} variant="default">
              {e}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      accessorKey: "isActive",
      header: "Status",
      cell: ({ row }) => (
        <Switch
          checked={row.original.isActive}
          onCheckedChange={(v) => {
            handleToggle(row.original.id, v);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    col.date<WebhookRow>("createdAt", "Created"),
  ];

  const deliveryRows: DeliveryRow[] = deliveries.map((d) => ({
    id: d.id,
    event: d.event,
    status: d.status,
    httpStatus: d.httpStatus,
    attempts: d.attempts,
    createdAt: new Date(d.createdAt),
  }));

  return (
    <PageShell>
      <PageHeader
        title="Webhooks"
        description="Subscribe to events from your Paylix account."
        action={<Button onClick={() => setCreateOpen(true)}>Add Endpoint</Button>}
      />

      {loading ? (
        <div className="rounded-lg border border-border bg-surface-1 py-16 text-center text-sm text-foreground-muted">
          Loading…
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          onRowClick={async (row) => {
            setSelected(row.raw);
            setSelectedSecret(null);
            setDeliveries([]);
            const res = await fetch(`/api/webhooks/${row.raw.id}`);
            if (res.ok) {
              const full = await res.json();
              setSelectedSecret(full.secret ?? null);
            }
          }}
          emptyState={
            <EmptyState
              title="No webhooks yet"
              description="Add an endpoint to start receiving events."
              action={
                <Button variant="outline" onClick={() => setCreateOpen(true)}>
                  Add your first endpoint
                </Button>
              }
            />
          }
        />
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(v) => (v ? setCreateOpen(true) : closeCreateDialog())}
      >
        <DialogContent className="border-border bg-surface-1 sm:max-w-[520px]">
          {createdSecret ? (
            <>
              <DialogHeader>
                <DialogTitle>Webhook Created</DialogTitle>
                <DialogDescription>
                  Copy your signing secret now. You can always view it again from the endpoint details.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <CopyableField label="Signing secret" value={createdSecret} />
                <p className="text-xs text-foreground-dim">
                  Use this secret to verify incoming webhook signatures on your server.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={closeCreateDialog}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Add Webhook Endpoint</DialogTitle>
                <DialogDescription>
                  Pick which events this endpoint should receive.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="webhook-url">Endpoint URL</Label>
                  <Input
                    id="webhook-url"
                    type="url"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://example.com/webhooks"
                    className="font-mono"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Events</Label>
                  <div className="flex flex-col gap-1">
                    {ALL_EVENTS.map((event) => (
                      <label
                        key={event.value}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-2"
                      >
                        <input
                          type="checkbox"
                          checked={newEvents.includes(event.value)}
                          onChange={() => toggleEvent(event.value)}
                          className="size-4 rounded border-border bg-surface-2 text-primary focus:ring-primary/20"
                        />
                        <span className="flex flex-col">
                          <span className="text-sm text-foreground">
                            {event.label}
                          </span>
                          <span className="font-mono text-xs text-foreground-muted">
                            {event.value}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeCreateDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={creating || !newUrl.trim() || newEvents.length === 0}
                >
                  {creating ? "Creating…" : "Add Endpoint"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <DetailDrawer
        open={selected !== null}
        onOpenChange={(v) => {
          if (!v) {
            setSelected(null);
            setSelectedSecret(null);
          }
        }}
        title="Webhook Endpoint"
        description={selected?.url}
        footer={
          <>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? "Sending…" : "Send Test"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => selected && setDeleteId(selected.id)}
            >
              Delete
            </Button>
          </>
        }
      >
        {selected && (
          <div className="flex flex-col gap-6">
            <div className="rounded-md border border-border bg-surface-2 p-4">
              <KeyValueList
                items={[
                  { label: "URL", value: selected.url, mono: true },
                  {
                    label: "Status",
                    value: selected.isActive ? "Active" : "Disabled",
                  },
                  {
                    label: "Events",
                    value: selected.events.join(", "),
                    mono: true,
                  },
                ]}
              />
            </div>
            <CopyableField
              label="Signing secret"
              value={selectedSecret ?? "Loading…"}
            />
            <Section title="Recent Deliveries">
              <DataTable
                columns={deliveryColumns}
                data={deliveryRows}
                emptyState={
                  <EmptyState
                    title="No deliveries yet"
                    description="Send a test event to see delivery results."
                  />
                }
              />
            </Section>
          </div>
        )}
      </DetailDrawer>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(v) => !v && setDeleteId(null)}
        title="Delete Webhook"
        description="This permanently removes this endpoint and all its delivery history."
        confirmLabel="Delete Webhook"
        variant="destructive"
        onConfirm={() => {
          if (deleteId) handleDelete(deleteId);
        }}
      />
    </PageShell>
  );
}
