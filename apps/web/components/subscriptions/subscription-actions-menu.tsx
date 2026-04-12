"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PauseCircle, PlayCircle, Trash2 } from "lucide-react";
import { ActionMenu, ConfirmDialog } from "@/components/paykit";
import type { ActionItem } from "@/components/paykit";

type ActionableStatus = "active" | "paused" | "past_due";

interface Props {
  subscriptionId: string;
  status: ActionableStatus;
  productName?: string | null;
}

export function SubscriptionActionsMenu({ subscriptionId, status, productName }: Props) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);

  async function handlePause() {
    const res = await fetch(`/api/subscriptions/${subscriptionId}/pause`, { method: "POST" });
    if (res.ok) {
      toast.success("Subscription paused");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data?.error?.message ?? "Failed to pause");
    }
  }

  async function handleResume() {
    const res = await fetch(`/api/subscriptions/${subscriptionId}/resume`, { method: "POST" });
    if (res.ok) {
      toast.success("Subscription resumed");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data?.error?.message ?? "Failed to resume");
    }
  }

  async function handleCancelConfirm() {
    const res = await fetch(`/api/subscriptions/${subscriptionId}/cancel-gasless`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Cancel failed");
    }
    router.refresh();
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  const cancelItem: ActionItem = {
    label: "Cancel subscription",
    icon: <Trash2 className="h-3.5 w-3.5" />,
    variant: "destructive",
    onSelect: () => setCancelOpen(true),
  };

  let items: ActionItem[];
  if (status === "active") {
    items = [
      {
        label: "Pause subscription",
        icon: <PauseCircle className="h-3.5 w-3.5" />,
        onSelect: handlePause,
      },
      { ...cancelItem, separatorBefore: true },
    ];
  } else if (status === "paused") {
    items = [
      {
        label: "Resume subscription",
        icon: <PlayCircle className="h-3.5 w-3.5" />,
        onSelect: handleResume,
      },
    ];
  } else {
    items = [cancelItem];
  }

  return (
    <>
      <ActionMenu items={items} />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel subscription?"
        description={
          productName
            ? `Stop charging "${productName}"? The subscription will be cancelled immediately and no further charges will be attempted.`
            : "Stop charging this subscription? It will be cancelled immediately and no further charges will be attempted."
        }
        confirmLabel="Cancel subscription"
        variant="destructive"
        onConfirm={handleCancelConfirm}
      />
    </>
  );
}
