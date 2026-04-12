"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";

interface Props {
  mode: "test" | "live";
}

export function ModeBanner({ mode }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (mode !== "test") return null;

  async function switchToLive() {
    try {
      const res = await fetch("/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "live" }),
      });
      if (res.ok) {
        startTransition(() => router.refresh());
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex h-9 items-center justify-center gap-2 bg-warning/10 px-4 text-xs text-warning">
      <TriangleAlert size={13} strokeWidth={2} />
      <span>You&apos;re in test mode. Data shown here isn&apos;t real.</span>
      <button
        type="button"
        onClick={switchToLive}
        disabled={pending}
        className="ml-1 underline underline-offset-2 hover:text-warning/80 disabled:opacity-50"
      >
        Switch to live mode →
      </button>
    </div>
  );
}
