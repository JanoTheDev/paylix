import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Free Trials" };

export default function FreeTrialsPage() {
  return (
    <>
      <PageHeading
        title="Free Trials"
        description="Let customers try a subscription before paying. Trials are entirely off-chain — no contract changes, no gas, no charge until the trial ends."
      />

      <Callout variant="info" title="No contract redeployment needed">
        Free trials are implemented as a database-layer feature on top of the
        existing SubscriptionManager contract. You can enable trials on any
        subscription product without touching Solidity or redeploying anything.
      </Callout>

      <SectionHeading>How it works</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        When a customer checks out a trial-enabled product, they sign an EIP-2612
        permit and a SubscriptionIntent — but Paylix stores the signatures in a{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          trialing
        </code>{" "}
        subscription row instead of submitting them on-chain. No USDC is moved
        during the trial period.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        When the trial ends, the keeper automatically replays the stored
        signatures via{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          createSubscriptionWithPermit
        </code>{" "}
        on the relayer wallet. The subscription activates on-chain and the first
        charge is collected. If the customer cancels during the trial, it is a
        simple database flip — no gas cost.
      </p>

      <SectionHeading>Enabling trials</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Set{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          trialDays
        </code>{" "}
        on a subscription product — either from the dashboard (Products page) or
        via the API.
      </p>

      <SubsectionHeading>Via the dashboard</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Edit a subscription product and set the &quot;Free trial days&quot; field.
        Any value greater than zero enables trials for that product.
      </p>

      <SubsectionHeading>Via the API</SubsectionHeading>
      <CodeBlock language="ts">{`const product = await paylix.createProduct({
  name: "Pro Plan",
  type: "subscription",
  priceCents: 2000,        // $20.00 USDC
  interval: "monthly",
  trialDays: 14,           // 14-day free trial
});`}</CodeBlock>

      <SubsectionHeading>Testing with trialMinutes</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        For development, use{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          trialMinutes
        </code>{" "}
        instead of{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          trialDays
        </code>{" "}
        to test the full trial-to-active conversion cycle quickly.
      </p>
      <CodeBlock language="ts">{`const product = await paylix.createProduct({
  name: "Pro Plan (test)",
  type: "subscription",
  priceCents: 2000,
  interval: "minutely",
  trialMinutes: 1,         // converts after 1 minute
});`}</CodeBlock>

      <SectionHeading>Trial lifecycle</SectionHeading>
      <ol className="mt-4 space-y-2 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-decimal">
        <li>
          Customer opens checkout for a trial-enabled product.
        </li>
        <li>
          Customer signs an EIP-2612 permit and a SubscriptionIntent. No charge
          happens.
        </li>
        <li>
          Paylix creates a subscription row with status{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            trialing
          </code>
          . The signed permit and intent are stored for later replay.
        </li>
        <li>
          During the trial, the customer can cancel from the portal or the
          merchant can cancel from the dashboard. This is a database flip — no
          gas.
        </li>
        <li>
          When{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            trial_ends_at
          </code>{" "}
          passes, the keeper&apos;s trial converter replays the stored signatures
          on-chain via the relayer wallet.
        </li>
        <li>
          The contract emits{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            SubscriptionCreated
          </code>
          . The indexer matches it to the existing trialing row and flips status
          to{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            active
          </code>
          .
        </li>
        <li>
          The first USDC charge is collected. Recurring charges follow the
          normal keeper schedule.
        </li>
      </ol>

      <SectionHeading>Anti-abuse protections</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Free trials are a common target for abuse. Paylix enforces several layers
        automatically:
      </p>
      <ul className="mt-4 space-y-2 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          <strong className="text-foreground">Email required</strong> — trial-enabled
          products require a customer email at checkout. Enforced in both the API
          and the checkout form.
        </li>
        <li>
          <strong className="text-foreground">Gmail normalization</strong> — dots are
          stripped and{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            +tag
          </code>{" "}
          suffixes are removed, so{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            a.l.i.c.e+trial@gmail.com
          </code>{" "}
          resolves to{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            alice@gmail.com
          </code>
          .
        </li>
        <li>
          <strong className="text-foreground">Disposable email blocking</strong> —
          148 known disposable email domains are blocked at checkout.
        </li>
        <li>
          <strong className="text-foreground">One trial per identity</strong> — dedup
          checks wallet address, customer email, and customer ID across all
          subscription statuses (including cancelled). One trial per product per
          identity, ever.
        </li>
        <li>
          <strong className="text-foreground">Wallet activity check</strong> — wallets
          with zero on-chain history (no sent transactions, no USDC balance) are
          blocked from starting trials.
        </li>
      </ul>

      <SectionHeading>Auto-fallback for returning customers</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        If a customer who already used a trial returns to the same product&apos;s
        checkout, Paylix automatically falls back to the regular paid subscription
        path. No error is shown — the customer simply proceeds without a free
        period.
      </p>

      <SectionHeading>Dashboard and portal</SectionHeading>
      <SubsectionHeading>Merchant dashboard</SubsectionHeading>
      <ul className="mt-4 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>Trial subscriptions show a trial badge and countdown timer.</li>
        <li>Cancel and retry buttons are available during the trial period.</li>
        <li>
          The Subscribers page filters by status, including{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            trialing
          </code>
          .
        </li>
      </ul>

      <SubsectionHeading>Customer portal</SubsectionHeading>
      <ul className="mt-4 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>Customers see a trial card with the remaining days and a cancel button.</li>
        <li>Cancelling during the trial is instant — no gas, no charge.</li>
      </ul>

      <SectionHeading>Webhook events</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Two webhook events are specific to trials:
      </p>
      <ul className="mt-4 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            subscription.trial_started
          </code>{" "}
          — fired when a customer begins a trial.
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            subscription.trial_converted
          </code>{" "}
          — fired when a trial converts to an active paid subscription.
        </li>
      </ul>
      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        Standard subscription events ({" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          subscription.created
        </code>
        ,{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          subscription.cancelled
        </code>
        ) also fire at the appropriate lifecycle stages.
      </p>

      <SectionHeading>SDK response</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        When creating a subscription for a trial-enabled product, the response
        includes{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          trialEndsAt
        </code>
        :
      </p>
      <CodeBlock language="ts">{`const { checkoutUrl, subscriptionId, trialEndsAt } =
  await paylix.createSubscription({
    productId: "prod_monthly_pro",
    customerId: "cust_xyz",
    successUrl: "https://example.com/welcome",
    cancelUrl: "https://example.com/pricing",
  });

console.log(trialEndsAt);
// "2026-04-26T00:00:00.000Z" (14 days from now)`}</CodeBlock>

      <SectionHeading>Quick test checklist</SectionHeading>
      <ol className="mt-4 space-y-2 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-decimal">
        <li>
          Create a product with{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            trialMinutes: 1
          </code>{" "}
          and{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            interval: &quot;minutely&quot;
          </code>
          .
        </li>
        <li>Open the checkout link and complete the signing flow.</li>
        <li>
          Verify the subscription appears as{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            trialing
          </code>{" "}
          in the dashboard.
        </li>
        <li>
          Wait ~1 minute. The keeper converts the trial and the status flips to{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            active
          </code>
          .
        </li>
        <li>Check webhook logs for the trial_started and trial_converted events.</li>
      </ol>
    </>
  );
}
