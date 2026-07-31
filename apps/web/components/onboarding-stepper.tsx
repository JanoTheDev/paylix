const STEPS = [
  { slug: "team", label: "Team" },
  { slug: "profile", label: "Profile" },
  { slug: "wallet", label: "Payout wallet" },
  { slug: "invite", label: "Invite team" },
] as const;

const DOT_CLASS = {
  active: "bg-primary",
  done: "bg-primary/50",
  todo: "bg-surface-3",
} as const;

const TEXT_CLASS = {
  active: "text-foreground",
  done: "text-foreground-muted",
  todo: "text-foreground-dim",
} as const;

export function OnboardingStepper({ active }: { active: string }) {
  const activeIdx = STEPS.findIndex((s) => s.slug === active);
  return (
    <ol className="flex items-center gap-3 font-mono text-xs tracking-wide">
      {STEPS.map((s, i) => {
        const state: keyof typeof DOT_CLASS =
          i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
        return (
          <li key={s.slug} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${DOT_CLASS[state]}`}
            />
            <span
              aria-current={state === "active" ? "step" : undefined}
              className={TEXT_CLASS[state]}
            >
              {s.label}
              {state === "done" && <span className="sr-only"> (completed)</span>}
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden="true" className="text-foreground-dim">
                —
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
