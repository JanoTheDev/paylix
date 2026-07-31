"use client";

import { PageShell, PageHeader, ErrorState } from "@/components/paykit";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PageShell>
      <PageHeader
        title="Something went wrong"
        description="This page could not be loaded."
      />
      <ErrorState
        title="Something went wrong"
        description={
          error.digest
            ? `We hit an unexpected error. Reference: ${error.digest}`
            : "We hit an unexpected error while loading this page."
        }
        onRetry={reset}
      />
    </PageShell>
  );
}
