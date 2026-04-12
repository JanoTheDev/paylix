"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, ActionMenu } from "@/components/paykit";
import type { ActionItem } from "@/components/paykit";
import { RefreshCw, Trash2 } from "lucide-react";

interface TrialActionButtonProps {
  subscriptionId: string;
  action: "cancel" | "retry";
  productName?: string | null;
}

export function TrialActionButton({
  subscriptionId,
  action,
  productName,
}: TrialActionButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (action === "cancel") {
    const items: ActionItem[] = [
      {
        label: "Cancel trial",
        icon: <Trash2 className="h-3.5 w-3.5" />,
        variant: "destructive",
        onSelect: () => setOpen(true),
      },
    ];

    async function handleConfirm() {
      const res = await fetch(
        `/api/subscriptions/${subscriptionId}/cancel-trial`,
        { method: "POST" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Cancel trial failed");
      }
      router.refresh();
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    return (
      <>
        <ActionMenu items={items} />
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Cancel trial?"
          description={
            productName
              ? `No charges have been made. Cancelling now ends the "${productName}" trial immediately.`
              : "No charges have been made. Cancelling now ends the trial immediately."
          }
          confirmLabel="Cancel trial"
          variant="destructive"
          onConfirm={handleConfirm}
        />
      </>
    );
  }

  async function handleRetry() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/subscriptions/${subscriptionId}/retry-trial`,
        { method: "POST" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Retry failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const items: ActionItem[] = [
    {
      label: busy ? "Retrying…" : "Retry conversion",
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      onSelect: handleRetry,
    },
  ];

  return (
    <div title={error ?? undefined}>
      <ActionMenu items={items} />
    </div>
  );
}
