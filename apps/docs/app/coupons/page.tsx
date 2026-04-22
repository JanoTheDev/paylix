import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Coupons" };

export default function CouponsPage() {
  return (
    <>
      <PageHeading
        title="Coupons"
        description="Discount codes buyers apply at checkout. Create codes from the dashboard; buyers type them into the hosted checkout and pay the discounted amount on-chain."
      />

      <Callout variant="info" title="Supported combinations">
        <strong>Percent</strong> and <strong>fixed-amount</strong> coupons
        work on one-time payments and on subscriptions with any{" "}
        <code>duration</code>. Subscription shapes:
      </Callout>
      <ul className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-foreground-muted">
        <li><strong>forever</strong> — every recurring charge runs at the discounted amount.</li>
        <li><strong>once</strong> — first charge discounted; every renewal at full price.</li>
        <li><strong>repeating</strong> — discounted for the first N charges, full price after.</li>
      </ul>
      <p className="mt-3 text-sm leading-relaxed text-foreground-muted">
        <code>once</code> and <code>repeating</code> use a
        per-subscription discount field stored by{" "}
        <code>createSubscriptionWithPermitDiscount</code> — the discount
        amount and cycle count are part of the buyer&apos;s signed
        intent, so a compromised relayer can&apos;t swap them.
      </p>

      <SectionHeading>Creating a coupon</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Open <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">/dashboard/coupons</code>,
        click <strong>New Coupon</strong>, and pick a code, type, duration, and
        optional redemption cap. Codes are stored uppercase; buyers type them
        case-insensitively.
      </p>

      <SubsectionHeading>Fields</SubsectionHeading>
      <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-foreground-muted">
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">code</code>{" "}
          — unique per organization.
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">type</code>{" "}
          — <code>percent</code> or <code>fixed</code>.
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">duration</code>{" "}
          — <code>once</code>, <code>forever</code>, or{" "}
          <code>repeating</code> (for future subscription support).
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">maxRedemptions</code>{" "}
          — optional cap, enforced atomically at redemption time.
        </li>
      </ul>

      <SectionHeading>Buyer flow</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        On one-time checkouts the hosted page shows a <em>Discount code</em>{" "}
        input. Applying a valid code updates the session amount immediately and
        the buyer signs the permit for the discounted total. Removing the
        coupon restores the original amount.
      </p>

      <SectionHeading>Webhook event</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        A <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">coupon.redeemed</code>{" "}
        event fires immediately after the on-chain payment lands, carrying the
        coupon id, discount amount, and the original subtotal.
      </p>

      <CodeBlock language="json">{`{
  "event": "coupon.redeemed",
  "timestamp": "2026-04-22T12:00:00.000Z",
  "data": {
    "couponId": "cou_...",
    "checkoutSessionId": "chk_...",
    "discountCents": 250,
    "amount": "7500000",
    "subtotalAmount": "10000000",
    "metadata": {}
  }
}`}</CodeBlock>

      <SectionHeading>Apply at checkout via the API</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The hosted checkout handles this out of the box. If you build a custom
        UI, POST to{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          /api/checkout/:sessionId/apply-coupon
        </code>{" "}
        with a <code>code</code>. DELETE the same path to remove.
      </p>
    </>
  );
}
