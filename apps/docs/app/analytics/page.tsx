import type { Metadata } from "next";
import {
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return (
    <>
      <PageHeading
        title="Analytics"
        description="Dashboard-only endpoint that returns time-series MRR, revenue, active subscribers, and failed-charge rate, plus a windowed ARPU."
      />

      <SectionHeading>Dashboard</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Open <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">/dashboard/analytics</code>.
        Pick a range (7d / 30d / 90d) to see four charts — MRR, revenue,
        active subscribers, and failed charge rate — plus five metric cards
        at the top.
      </p>

      <SectionHeading>Endpoint</SectionHeading>
      <CodeBlock language="http">{`GET /api/analytics?range=30`}</CodeBlock>

      <SubsectionHeading>Response</SubsectionHeading>
      <CodeBlock language="json">{`{
  "range": 30,
  "start": "2026-03-24T00:00:00.000Z",
  "end": "2026-04-22T00:00:00.000Z",
  "revenueByDay": [{ "date": "2026-04-22", "value": 123400 }],
  "mrrByDay": [{ "date": "2026-04-22", "value": 500000 }],
  "activeSubsByDay": [{ "date": "2026-04-22", "value": 42 }],
  "failedRateByDay": [{
    "date": "2026-04-22",
    "value": { "rate": 0.05, "failed": 1, "attempted": 20 }
  }],
  "arpuCents": 2500
}`}</CodeBlock>

      <SubsectionHeading>How metrics are computed</SubsectionHeading>
      <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-foreground-muted">
        <li>
          <strong>MRR</strong>: for each day, sum of monthly-normalized amounts
          for subscriptions whose status is <code>active</code>/<code>past_due</code>
          (or were before being cancelled). Amount is derived from{" "}
          <code>product_prices</code> and assumes USDC 6-decimals for v1.
        </li>
        <li>
          <strong>Revenue</strong>: confirmed payments summed per day.
        </li>
        <li>
          <strong>Active subs</strong>: count with the same active-on-day rule as
          MRR.
        </li>
        <li>
          <strong>Failed rate</strong>: <code>failed / (confirmed + failed)</code>.
          Pending is excluded.
        </li>
        <li>
          <strong>ARPU</strong>: window revenue divided by distinct paying
          customer ids in the same window.
        </li>
      </ul>

      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        All math is integer cents. Responses are cached per org for five
        minutes (<code>Cache-Control: private, max-age=300</code>).
      </p>
    </>
  );
}
