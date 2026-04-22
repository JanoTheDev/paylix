import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Gift Subscriptions" };

export default function GiftSubscriptionsPage() {
  return (
    <>
      <PageHeading
        title="Gift Subscriptions"
        description="Grant a free subscription to a customer — no wallet, no USDC, no on-chain transaction. Useful for influencers, partners, beta users, and incident comps."
      />

      <Callout variant="info" title="Purely off-chain">
        Gift subs never touch the SubscriptionManager contract. The keeper
        never calls chargeSubscription on them. The row behaves like an
        active subscription for every other purpose (invoices, portal
        actions, webhooks) and carries a <code>gift: true</code> flag on
        its webhook payload.
      </Callout>

      <SectionHeading>Create via the SDK</SectionHeading>
      <CodeBlock language="ts">{`await paylix.giftSubscription({
  productId: "prod_monthly_pro",
  customerId: "cust_123",
  // Optional — omit for an indefinite gift.
  expiresAt: "2026-12-31T00:00:00.000Z",
  metadata: { reason: "beta-user" },
});`}</CodeBlock>

      <SubsectionHeading>Parameters</SubsectionHeading>
      <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-foreground-muted">
        <li>
          <code>productId</code> — must be a subscription product.
        </li>
        <li>
          <code>customerId</code> — the external customer id you use in
          your app. The customer must already exist in Paylix.
        </li>
        <li>
          <code>expiresAt</code> — optional. If set, the keeper flips the
          row to <code>cancelled</code> when the date passes and fires{" "}
          <code>subscription.cancelled</code> with{" "}
          <code>reason: "gift_expired"</code>. Omit for indefinite gifts.
        </li>
      </ul>

      <SectionHeading>Blocklist still applies</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The gift endpoint runs the same wallet / email / country blocklist
        check as the normal relay path, so a merchant can't accidentally
        grant a comp to someone they've already blocked.
      </p>

      <SectionHeading>Webhook payload</SectionHeading>
      <CodeBlock language="json">{`{
  "event": "subscription.created",
  "timestamp": "2026-04-22T12:00:00.000Z",
  "data": {
    "subscriptionId": "3a1f...",
    "productId": "prod_monthly_pro",
    "customerId": "cust_123",
    "gift": true,
    "expiresAt": "2026-12-31T00:00:00.000Z",
    "metadata": { "reason": "beta-user" }
  }
}`}</CodeBlock>
    </>
  );
}
