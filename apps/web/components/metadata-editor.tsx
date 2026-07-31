"use client";

import { useId, useMemo } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Row = { id: string; key: string; value: string };

interface MetadataEditorProps {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  className?: string;
}

function toRows(value: Record<string, string>): Row[] {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return [{ id: crypto.randomUUID(), key: "", value: "" }];
  }
  return entries.map(([k, v]) => ({
    id: crypto.randomUUID(),
    key: k,
    value: v,
  }));
}

function toObject(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (!k) continue;
    out[k] = r.value;
  }
  return out;
}

export function MetadataEditor({
  value,
  onChange,
  disabled = false,
  label = "Metadata",
  description,
  className,
}: MetadataEditorProps) {
  const rows = useMemo(() => toRows(value), [value]);

  const duplicates = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const r of rows) {
      const k = r.key.trim();
      if (!k) continue;
      if (seen.has(k)) dup.add(k);
      seen.add(k);
    }
    return dup;
  }, [rows]);

  function update(next: Row[]) {
    onChange(toObject(next));
  }

  function setRow(id: string, patch: Partial<Row>) {
    update(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    const next = rows.filter((r) => r.id !== id);
    if (next.length === 0) {
      onChange({});
    } else {
      update(next);
    }
  }

  function addRow() {
    const next = [...rows, { id: crypto.randomUUID(), key: "", value: "" }];
    update(next);
  }

  // The editor is a repeating group, not a single control, so it is a
  // <fieldset>/<legend> and each input carries its own accessible name —
  // a bare <Label> with no `htmlFor` labels nothing.
  const groupId = useId();

  return (
    <fieldset className={cn("min-w-0 space-y-2", className)}>
      <div>
        <legend className="text-sm leading-none font-medium">{label}</legend>
        {description && (
          <p className="mt-0.5 text-xs text-foreground-muted">{description}</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => {
          const isDup = r.key.trim() && duplicates.has(r.key.trim());
          return (
            <div key={r.id} className="flex items-start gap-2">
              <Input
                id={`${groupId}-key-${r.id}`}
                aria-label={`${label} key ${i + 1}`}
                aria-invalid={isDup ? true : undefined}
                placeholder="key"
                value={r.key}
                disabled={disabled}
                onChange={(e) => setRow(r.id, { key: e.target.value })}
                className={cn(
                  "flex-1 font-mono text-xs",
                  isDup && "border-destructive",
                )}
              />
              <Input
                id={`${groupId}-value-${r.id}`}
                aria-label={`${label} value ${i + 1}`}
                placeholder="value"
                value={r.value}
                disabled={disabled}
                onChange={(e) => setRow(r.id, { value: e.target.value })}
                className="flex-[2] font-mono text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                onClick={() => removeRow(r.id)}
                className="shrink-0"
                aria-label={
                  r.key.trim()
                    ? `Remove ${r.key.trim()}`
                    : `Remove ${label.toLowerCase()} row ${i + 1}`
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>
      {duplicates.size > 0 && (
        <p role="alert" className="text-xs text-destructive">
          Duplicate keys are not allowed: {Array.from(duplicates).join(", ")}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={addRow}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" /> Add row
      </Button>
    </fieldset>
  );
}
