"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  PageShell,
  PageHeader,
  DataTable,
  EmptyState,
  SecretRevealDialog,
  ConfirmDialog,
  ActionMenu,
  col,
} from "@/components/paykit";
import type { ActionItem } from "@/components/paykit";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  type: "publishable" | "secret";
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

type ApiKeyRow = {
  id: string;
  name: string;
  prefixDisplay: string;
  type: "publishable" | "secret";
  state: "active" | "revoked";
  lastUsedAt: Date | null;
  createdAt: Date;
  isActive: boolean;
};

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyType, setNewKeyType] = useState<"publishable" | "secret">(
    "publishable",
  );
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    const res = await fetch("/api/keys");
    if (res.ok) setKeys(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName, type: newKeyType }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedKey(data.key);
        setCreateOpen(false);
        setNewKeyName("");
        setNewKeyType("publishable");
        fetchKeys();
        toast.success("API key created");
      } else {
        toast.error("Failed to create API key");
      }
    } catch {
      toast.error("Failed to create API key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRevokeId(null);
        fetchKeys();
        toast.success("API key revoked");
      } else {
        toast.error("Failed to revoke API key");
      }
    } catch {
      toast.error("Failed to revoke API key");
    }
  }

  const rows: ApiKeyRow[] = keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefixDisplay: `${k.prefix}…`,
    type: k.type,
    state: k.isActive ? "active" : "revoked",
    lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt) : null,
    createdAt: new Date(k.createdAt),
    isActive: k.isActive,
  }));

  const columns: ColumnDef<ApiKeyRow, unknown>[] = [
    col.text<ApiKeyRow>("name", "Name"),
    col.mono<ApiKeyRow>("prefixDisplay", "Prefix"),
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => (
        <Badge
          variant={row.original.type === "publishable" ? "info" : "warning"}
        >
          {row.original.type === "publishable" ? "Publishable" : "Secret"}
        </Badge>
      ),
    },
    col.status<ApiKeyRow>("state", "Status", "apiKey"),
    col.date<ApiKeyRow>("lastUsedAt", "Last Used"),
    col.date<ApiKeyRow>("createdAt", "Created"),
    col.actions<ApiKeyRow>((row) => {
      if (!row.isActive) return null;
      const items: ActionItem[] = [
        {
          label: "Revoke",
          variant: "destructive",
          onSelect: () => setRevokeId(row.id),
        },
      ];
      return <ActionMenu items={items} />;
    }),
  ];

  return (
    <PageShell>
      <PageHeader
        title="API Keys"
        description="Publishable keys are safe in client code. Secret keys must stay server-side."
        action={<Button onClick={() => setCreateOpen(true)}>Generate Key</Button>}
      />

      {loading ? (
        <div className="rounded-lg border border-border bg-surface-1 py-16 text-center text-sm text-foreground-muted">
          Loading…
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          emptyState={
            <EmptyState
              title="No API keys yet"
              description="Generate your first key to start making API calls."
              action={
                <Button variant="outline" onClick={() => setCreateOpen(true)}>
                  Generate your first key
                </Button>
              }
            />
          }
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-border bg-surface-1 sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
            <DialogDescription>Name and scope the new key.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Production Backend"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="key-type">Type</Label>
              <Select
                value={newKeyType}
                onValueChange={(v) =>
                  setNewKeyType(v as "publishable" | "secret")
                }
              >
                <SelectTrigger id="key-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="publishable">Publishable</SelectItem>
                  <SelectItem value="secret">Secret</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !newKeyName.trim()}
            >
              {creating ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SecretRevealDialog
        open={createdKey !== null}
        onOpenChange={(v) => !v && setCreatedKey(null)}
        title="Key Created"
        description="Copy and store this key securely. It won't be shown again."
        secret={createdKey ?? ""}
        onAcknowledge={() => setCreatedKey(null)}
      />

      <ConfirmDialog
        open={revokeId !== null}
        onOpenChange={(v) => !v && setRevokeId(null)}
        title="Revoke API Key"
        description="This cannot be undone. Any integrations using this key will stop working immediately."
        confirmLabel="Revoke Key"
        variant="destructive"
        onConfirm={() => {
          if (revokeId) handleRevoke(revokeId);
        }}
      />
    </PageShell>
  );
}
