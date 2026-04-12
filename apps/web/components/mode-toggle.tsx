"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface Props {
  mode: "test" | "live";
}

export function ModeToggle({ mode }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticMode, setOptimisticMode] = useState(mode);

  async function handleToggle(checked: boolean) {
    const newMode = checked ? "live" : "test";
    setOptimisticMode(newMode);
    try {
      const res = await fetch("/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
      if (!res.ok) {
        setOptimisticMode(mode);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setOptimisticMode(mode);
    }
  }

  const isLive = optimisticMode === "live";

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-md border px-3 py-2 text-xs font-medium transition-colors",
        isLive
          ? "border-primary/30 bg-primary/5 text-primary"
          : "border-warning/30 bg-warning/5 text-warning",
      )}
    >
      <span className="font-mono uppercase tracking-wide">
        {isLive ? "Live mode" : "Test mode"}
      </span>
      <Switch
        checked={isLive}
        onCheckedChange={handleToggle}
        disabled={pending}
        aria-label="Toggle test/live mode"
        size="sm"
      />
    </div>
  );
}
