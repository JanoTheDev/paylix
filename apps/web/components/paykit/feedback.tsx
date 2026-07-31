import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LoadingStateProps {
  variant?: "table" | "card" | "detail";
}

export function LoadingState({ variant = "card" }: LoadingStateProps) {
  const shell =
    "flex flex-col rounded-lg border border-border bg-surface-1";
  if (variant === "table") {
    return (
      <div role="status" aria-busy="true" className={`${shell} gap-3 p-4`}>
        <span className="sr-only">Loading…</span>
        {["row-1", "row-2", "row-3", "row-4", "row-5"].map((rowKey) => (
          <Skeleton key={rowKey} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (variant === "detail") {
    return (
      <div role="status" aria-busy="true" className={`${shell} gap-4 p-6`}>
        <span className="sr-only">Loading…</span>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  return (
    <div role="status" aria-busy="true" className={`${shell} gap-3 p-6`}>
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-8 w-24" />
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  description = "An error occurred while loading this content.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface-1 px-6 py-12 text-center"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-destructive/10 text-destructive">
        <AlertCircle aria-hidden="true" className="h-4 w-4" />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-foreground-muted">{description}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
