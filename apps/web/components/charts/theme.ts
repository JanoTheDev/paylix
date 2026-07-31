/**
 * Shared recharts styling, sourced from the design tokens in
 * `app/globals.css` rather than repeated hex literals (DESIGN.md §2).
 *
 * Recharts writes these straight into SVG `fill`/`stroke` attributes and
 * inline styles, both of which resolve `var(--token)` at paint time, so the
 * charts follow the surface they sit on instead of drifting from it.
 */

// Every value carries the literal from DESIGN.md §2 as a `var()` fallback.
// Recharts writes several of these into SVG *presentation attributes*
// (`fill`, `stroke`), and Safari below 16.4 does not resolve `var()` there —
// without the fallback the ticks and series would paint black on the #07070a
// canvas. The fallbacks must stay in sync with `app/globals.css`.
export const chartTheme = {
  /** Axis tick labels — secondary text tier. */
  tick: { fill: "var(--foreground-muted, #94a3b8)", fontSize: 11 } as const,
  /** Axis rule — the emphasized border tier. */
  axisLine: {
    stroke: "var(--border-strong, rgba(148, 163, 184, 0.20))",
  } as const,
  /** Cartesian grid — the faintest divider tier. */
  gridStroke: "var(--border-subtle, rgba(148, 163, 184, 0.08))",
  /** Tooltip panel — elevated surface (DESIGN.md §6 L2). */
  tooltipContent: {
    backgroundColor: "var(--surface-2, #18181e)",
    border: "1px solid var(--border-strong, rgba(148, 163, 184, 0.20))",
    borderRadius: 8,
    color: "var(--foreground, #f0f0f3)",
  } as const,
  tooltipLabel: { color: "var(--foreground, #f0f0f3)" } as const,
  /** Series colours. Teal is the brand series; red marks a failure series. */
  series: {
    primary: "var(--primary, #06d6a0)",
    destructive: "var(--destructive, #f87171)",
  } as const,
} as const;

/** Shared card chrome for every chart panel — matches `MetricCard`. */
export const chartCardClass = "rounded-lg border border-border bg-surface-1 p-4";

export const chartTitleClass = "mb-4 text-sm font-medium text-foreground";
