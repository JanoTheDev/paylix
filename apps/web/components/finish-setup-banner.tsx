import Link from "next/link";

export function FinishSetupBanner({
  nextHref,
  nextLabel,
}: {
  nextHref: string;
  nextLabel: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <div>
        <p className="text-sm text-foreground">Finish setting up your team</p>
        <p className="text-xs text-foreground-muted">{nextLabel}</p>
      </div>
      <Link
        href={nextHref}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Continue
      </Link>
    </div>
  );
}
