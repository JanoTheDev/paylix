"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
  { value: "subscription.trial_started", label: "Trial started" },
  { value: "subscription.trial_ending", label: "Trial ending" },
  { value: "subscription.trial_converted", label: "Trial converted" },
  { value: "subscription.trial_cancelled", label: "Trial cancelled" },
  { value: "invoice.issued", label: "Invoice issued" },
  { value: "invoice.email_sent", label: "Invoice email sent" },
  { value: "invoice.email_failed", label: "Invoice email failed" },
  { value: "coupon.redeemed", label: "Coupon redeemed" },
];

function buildDeliveryColumns(
  onReplay: (id: string) => void,
  replayingId: string | null,
): ColumnDef<DeliveryRow, unknown>[] {
  return [
    col.text<DeliveryRow>("event", "Event"),
    col.status<DeliveryRow>("status", "Status", "delivery"),
    col.text<DeliveryRow>("httpStatus", "HTTP", { align: "right" }),
    col.text<DeliveryRow>("attempts", "Attempts", { align: "right" }),
    col.dateTime<DeliveryRow>("createdAt", "Timestamp"),
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          disabled={replayingId === row.original.id}
          onClick={() => onReplay(row.original.id)}
        >
          {replayingId === row.original.id ? "Replaying…" : "Replay"}
        </Button>
      ),
    },
  ];
}

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
  const [editing, setEditing] = useState(false);
  const [editUrl, setEditUrl] = useState("");
  const [editEvents, setEditEvents] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string>("");
  const [testEventModalOpen, setTestEventModalOpen] = useState(false);
  const [testEvent, setTestEvent] = useState<string>("payment.confirmed");
  const [replayingId, setReplayingId] = useState<string | null>(null);

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
    try {
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
        toast.success("Webhook created");
      } else {
        toast.error("Failed to create webhook");
      }
    } catch {
      toast.error("Failed to create webhook");
    } finally {
      setCreating(false);
    }
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
    try {
      const res = await fetch(`/api/webhooks/${selected.id}/send-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: testEvent }),
      });
      if (res.ok) {
        setTestEventModalOpen(false);
        await loadDeliveries(selected.id);
        toast.success("Test event sent");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error?.message ?? "Failed to send test event");
      }
    } catch {
      toast.error("Failed to send test event");
    } finally {
      setTesting(false);
    }
  }

  async function handleReplay(deliveryId: string) {
    if (!selected) return;
    setReplayingId(deliveryId);
    try {
      const res = await fetch(`/api/webhooks/deliveries/${deliveryId}/replay`, {
        method: "POST",
      });
      if (res.ok) {
        await loadDeliveries(selected.id);
        toast.success("Delivery replayed");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error?.message ?? "Replay failed");
      }
    } catch {
      toast.error("Replay failed");
    } finally {
      setReplayingId(null);
    }
  }

  async function loadDeliveries(webhookId: string) {
    const res = await fetch(`/api/webhooks/${webhookId}/deliveries`);
    if (res.ok) {
      const data = await res.json();
      setDeliveries(data.deliveries ?? []);
    }
  }

  function startEdit() {
    if (!selected) return;
    setEditUrl(selected.url);
    setEditEvents([...selected.events]);
    setEditError("");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditError("");
  }

  async function saveEdit() {
    if (!selected) return;
    if (!editUrl.trim() || editEvents.length === 0) return;
    setSavingEdit(true);
    setEditError("");
    try {
      const res = await fetch(`/api/webhooks/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: editUrl, events: editEvents }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = data.error ?? "Failed to save";
        setEditError(message);
        toast.error(message);
        return;
      }
      const updated = await res.json();
      setSelected({ ...selected, url: updated.url, events: updated.events });
      setEditing(false);
      fetchWebhooks();
      toast.success("Webhook saved");
    } catch {
      setEditError("Failed to save");
      toast.error("Failed to save webhook");
    } finally {
      setSavingEdit(false);
    }
  }

  function toggleEditEvent(event: string) {
    setEditEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
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
            setEditing(false);
            const [full, _] = await Promise.all([
              fetch(`/api/webhooks/${row.raw.id}`).then((r) =>
                r.ok ? r.json() : null,
              ),
              loadDeliveries(row.raw.id),
            ]);
            if (full?.secret) setSelectedSecret(full.secret);
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
            setEditing(false);
          }
        }}
        title="Webhook Endpoint"
        description={selected?.url}
        footer={
          editing ? (
            <>
              <Button variant="outline" onClick={cancelEdit} disabled={savingEdit}>
                Cancel
              </Button>
              <Button
                onClick={saveEdit}
                disabled={savingEdit || !editUrl.trim() || editEvents.length === 0}
              >
                {savingEdit ? "Saving…" : "Save changes"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={startEdit}>
                Edit
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setTestEvent(selected?.events[0] ?? "payment.confirmed");
                  setTestEventModalOpen(true);
                }}
              >
                Send Test
              </Button>
              <Button
                variant="destructive"
                onClick={() => selected && setDeleteId(selected.id)}
              >
                Delete
              </Button>
            </>
          )
        }
      >
        {selected && !editing && (
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
                columns={buildDeliveryColumns(handleReplay, replayingId)}
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
        {selected && editing && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-webhook-url">Endpoint URL</Label>
              <Input
                id="edit-webhook-url"
                type="url"
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
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
                      checked={editEvents.includes(event.value)}
                      onChange={() => toggleEditEvent(event.value)}
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
            {editError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {editError}
              </div>
            )}
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

      <Dialog open={testEventModalOpen} onOpenChange={setTestEventModalOpen}>
        <DialogContent className="border-border bg-surface-1 sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Send Test Event</DialogTitle>
            <DialogDescription>
              Dispatches a synthetic event with <code>livemode: false</code> and
              a <code>evt_test_*</code> marker. Only events this webhook is
              subscribed to can be sent.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="test-event">Event</Label>
            <select
              id="test-event"
              value={testEvent}
              onChange={(e) => setTestEvent(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {(selected?.events ?? []).map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestEventModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleTest} disabled={testing || !selected}>
              {testing ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
