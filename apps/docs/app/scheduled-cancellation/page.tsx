import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Scheduled Cancellation" };

export default function ScheduledCancellationPage() {
  return (
    <>
      <PageHeading
        title="Scheduled Cancellation"
        description="Let customers cancel mid-cycle but keep access until the end of the billing period, with the option to undo before the boundary passes."
      />

      <Callout variant="info" title="Standard SaaS behavior">
        The default <code>cancelSubscription</code> SDK call is an
        immediate cancellation. For period-end cancellation, use{" "}
        <code>scheduleSubscriptionCancellation</code> or call{" "}
        <code>POST /api/subscriptions/:id/cancel</code> with{" "}
        <code>{'{ "when": "period_end" }'}</code>.
      </Callout>

      <SectionHeading>Merchant flow</SectionHeading>
      <CodeBlock language="ts">{`// Schedule: keeps status=active, flips on next_charge_date.
const { cancelAt } = await paylix.scheduleSubscriptionCancellation(subId);

// Undo before the boundary:
await paylix.resumeSubscriptionSchedule(subId);`}</CodeBlock>

      <SectionHeading>Portal flow</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Customer-facing endpoints (no API key, portal token auth):
      </p>
      <ul className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-foreground-muted">
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            POST /api/portal/cancel-at-period-end
          </code>{" "}
          — body:{" "}
          <code>{'{ subscriptionId, customerId, token }'}</code>.
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            POST /api/portal/resume-schedule
          </code>{" "}
          — same body, clears the flag.
        </li>
      </ul>

      <SectionHeading>Keeper behavior</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        On every tick the keeper checks due subscriptions. If{" "}
        <code>cancel_at_period_end</code> is set, instead of charging it
        flips the row to <code>cancelled</code>, nulls out{" "}
        <code>next_charge_date</code>, and fires{" "}
        <code>subscription.cancelled</code> with{" "}
        <code>reason: "scheduled"</code>. No on-chain transaction — the
        keeper is the only party that ever calls{" "}
        <code>chargeSubscription</code>, so skipping here is sufficient.
      </p>

      <SubsectionHeading>Invariants</SubsectionHeading>
      <ul className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-foreground-muted">
        <li>
          <code>cancel_at_period_end</code> can only be set on an{" "}
          <code>active</code> subscription with a{" "}
          <code>next_charge_date</code>.
        </li>
        <li>
          The{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            subscription.cancelled
          </code>{" "}
          webhook fires exactly once — at the flip, not at the schedule.
        </li>
        <li>
          <code>cancelSubscription</code> with{" "}
          <code>when: "immediate"</code> clears the scheduled flag and
          flips status now.
        </li>
      </ul>
    </>
  );
}
