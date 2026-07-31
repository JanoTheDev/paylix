"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="w-full max-w-[480px] rounded-xl border border-border bg-surface-1 p-8 text-center">
      <div className="mb-3 flex justify-center">
        <AlertCircle size={40} strokeWidth={1.5} className="text-destructive" />
      </div>
      <h1 className="mb-2 text-xl font-semibold tracking-tight">
        We couldn&apos;t load this checkout
      </h1>
      <p className="text-sm leading-relaxed text-foreground-muted">
        No payment was taken. Try again, or contact the merchant if this keeps
        happening.
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-[11px] text-foreground-dim">
          Reference: {error.digest}
        </p>
      )}
      <Button variant="outline" className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
