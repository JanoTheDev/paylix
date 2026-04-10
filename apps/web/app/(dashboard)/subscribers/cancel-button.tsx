"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, ActionMenu } from "@/components/paykit";
import type { ActionItem } from "@/components/paykit";
import { Trash2 } from "lucide-react";

interface CancelButtonProps {
  subscriptionId: string;
  /**
   * Kept for API compatibility with the previous signature. No longer used
   * since cancellation is now backend-relayed.
   */
  onChainId?: string | null;
  productName?: string | null;
}

export default function CancelButton({
  subscriptionId,
  productName,
}: CancelButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const items: ActionItem[] = [
    {
      label: "Cancel subscription",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      variant: "destructive",
      onSelect: () => setOpen(true),
    },
  ];

  async function handleConfirm() {
    const res = await fetch(
      `/api/subscriptions/${subscriptionId}/cancel-gasless`,
      { method: "POST" },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Cancel failed");
    }
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <>
      <ActionMenu items={items} />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cancel subscription?"
        description={
          productName
            ? `Stop charging "${productName}"? The subscription will be cancelled immediately and no further charges will be attempted.`
            : "Stop charging this subscription? It will be cancelled immediately and no further charges will be attempted."
        }
        confirmLabel="Cancel subscription"
        variant="destructive"
        onConfirm={handleConfirm}
      />
    </>
  );
}
