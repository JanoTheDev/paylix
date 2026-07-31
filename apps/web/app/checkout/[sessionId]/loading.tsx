import { Skeleton } from "@/components/ui/skeleton";

export default function CheckoutLoading() {
  return (
    <div className="w-full max-w-[480px] rounded-xl border border-border bg-surface-1 p-8">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-3 h-4 w-64" />
      <Skeleton className="mt-8 h-9 w-40" />
      <Skeleton className="mt-8 h-11 w-full" />
      <Skeleton className="mt-3 h-3 w-32 mx-auto" />
    </div>
  );
}
