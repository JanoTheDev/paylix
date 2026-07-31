import { PageShell, LoadingState } from "@/components/paykit";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <PageShell>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <LoadingState variant="table" />
    </PageShell>
  );
}
