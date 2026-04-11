import Link from "next/link";

export function FinishSetupBanner({
  nextHref,
  nextLabel,
}: {
  nextHref: string;
  nextLabel: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#06d6a0]/30 bg-[#06d6a0]/5 px-4 py-3">
      <div>
        <p className="text-sm text-slate-100">Finish setting up your team</p>
        <p className="text-xs text-slate-400">{nextLabel}</p>
      </div>
      <Link
        href={nextHref}
        className="rounded-md bg-[#06d6a0] px-3 py-1.5 text-xs font-medium text-[#07070a]"
      >
        Continue
      </Link>
    </div>
  );
}
