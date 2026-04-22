import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Webhooks" };

export default function Webhooks() {
  return (
    <>
      <PageHeading
        title="Webhooks"
        description="Paylix sends webhook events to your server when payments and subscriptions change state. Use webhooks to fulfill orders, activate subscriptions, and keep your system in sync with on-chain activity."
      />

      <Callout variant="tip" title="Always verify signatures">
        Webhook URLs are public by nature — anyone who discovers yours could
        POST fake events to it. Verifying the{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          x-paylix-signature
        </code>{" "}
        header with your webhook secret proves the request actually came from
        Paylix. Never fulfill an order from an unverified webhook payload.
      </Callout>

      <SectionHeading>Setting Up Webhooks</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Configure your webhook endpoint in the Paylix dashboard under{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          Settings → Webhooks
        </code>
        . You&apos;ll receive a webhook secret (
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          whsec_...
        </code>
        ) used to verify signatures.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-foreground-muted">
        You can also manage webhooks programmatically via the SDK — create,
        list, update, and delete endpoints without touching the dashboard.
        See the{" "}
        <a
          href="/sdk-reference#paylix-createwebhook"
          className="font-medium text-primary underline underline-offset-2"
        >
          SDK Reference
        </a>{" "}
        for details.
      </p>

      <SubsectionHeading>Programmatic Setup</SubsectionHeading>
      <CodeBlock language="ts">{`import { Paylix } from "@paylix/sdk";

const paylix = new Paylix({
  apiKey: "sk_test_...",
  network: "base-sepolia",
  backendUrl: "https://paylix.example.com",
});

const hook = await paylix.createWebhook({
  url: "https://example.com/webhooks/paylix",
  events: ["payment.confirmed", "subscription.created"],
});

// Save this — it's only returned once
console.log("Secret:", hook.secret);`}</CodeBlock>

      <SectionHeading>Signature Verification</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Every webhook request includes an{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          x-paylix-signature
        </code>{" "}
        header. Always verify the signature before processing the event.
      </p>

      <SubsectionHeading>Next.js App Router</SubsectionHeading>
      <CodeBlock language="ts">{`import { webhooks } from "@paylix/sdk";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const payload = await req.text();
  const signature = req.headers.get("x-paylix-signature")!;

  const isValid = webhooks.verify({
    payload,
    signature,
    secret: process.env.PAYLIX_WEBHOOK_SECRET!,
  });

  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const webhook = JSON.parse(payload);

  switch (webhook.event) {
    case "payment.confirmed":
      // Fulfill the order
      await fulfillOrder(webhook.data.productId, webhook.data.customerId);
      break;

    case "subscription.created":
      // Activate the subscription in your database
      await activateSubscription(webhook.data.subscriptionId);
      break;

    case "subscription.charged":
      // Record the recurring charge
      await recordCharge(webhook.data.subscriptionId, webhook.data.amount);
      break;

    case "subscription.past_due":
      // Notify the customer, restrict access
      await handlePastDue(webhook.data.subscriptionId);
      break;

    case "subscription.cancelled":
      // Revoke access
      await revokeAccess(webhook.data.subscriptionId);
      break;
  }

  return NextResponse.json({ received: true });
}`}</CodeBlock>

      <SubsectionHeading>Express</SubsectionHeading>
      <CodeBlock language="ts">{`import express from "express";
import { webhooks } from "@paylix/sdk";

const app = express();

// Use raw body for signature verification
app.post(
  "/api/webhooks/paylix",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const payload = req.body.toString();
    const signature = req.headers["x-paylix-signature"] as string;

    const isValid = webhooks.verify({
      payload,
      signature,
      secret: process.env.PAYLIX_WEBHOOK_SECRET!,
    });

    if (!isValid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const webhook = JSON.parse(payload);
    // Handle webhook.event ...

    res.json({ received: true });
  }
);`}</CodeBlock>

      <SectionHeading>Event Types</SectionHeading>

      <p className="text-sm leading-relaxed text-foreground-muted">
        Every webhook body has the same envelope: an <code>event</code> name, an
        ISO <code>timestamp</code>, a <code>livemode</code> boolean, and an
        event-specific <code>data</code>{" "}
        object. Any <code>metadata</code> you set when creating the checkout or
        subscription is echoed back on every event so you can correlate it with
        your own order or user IDs.
      </p>

      <SubsectionHeading>payment.confirmed</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent when a one-time payment is confirmed on-chain. This is the primary
        event for fulfilling orders.
      </p>
      <CodeBlock language="json">{`{
  "event": "payment.confirmed",
  "timestamp": "2026-04-10T18:23:05.166Z",
  "data": {
    "paymentId": "1f23991d-105e-4e62-b21c-bd7e05b1b8cd",
    "checkoutId": "d2a27cbf-cf97-4e04-b8db-835561601241",
    "productId": "911da752-2e08-4469-b1e9-9ea60677d14b",
    "customerId": "anon_0x82A9...a2de",
    "amount": 1000,
    "fee": 5,
    "currency": "USDC",
    "chain": "base",
    "txHash": "0xfea3...d4c2",
    "fromAddress": "0x82A9...a2de",
    "toAddress": "0xAeB3...8934",
    "metadata": { "orderId": "42" }
  }
}`}</CodeBlock>

      <SubsectionHeading>payment.refunded</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent when a merchant records a refund on a payment. Refunds are
        non-custodial — the merchant sent USDC from their own wallet
        back to the buyer and pasted the tx hash into the dashboard or
        SDK. Paylix verifies the transfer on-chain before firing this
        event. The 0.5% platform fee on the original charge is not
        returned.
      </p>
      <CodeBlock language="json">{`{
  "event": "payment.refunded",
  "timestamp": "2026-04-22T14:00:00.000Z",
  "data": {
    "paymentId": "1f23...",
    "refundId": "rfd_...",
    "amount": 1000,
    "reason": "Customer requested refund",
    "txHash": "0xabcd...",
    "metadata": { "orderId": "42" }
  }
}`}</CodeBlock>

      <SubsectionHeading>subscription.created</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent when a customer successfully sets up a new subscription and the
        first payment is confirmed.
      </p>
      <CodeBlock language="json">{`{
  "event": "subscription.created",
  "timestamp": "2026-04-10T18:23:05.166Z",
  "data": {
    "subscriptionId": "3a1f...",
    "onChainId": "17",
    "checkoutId": "d2a2...",
    "productId": "911d...",
    "customerId": "anon_0x82A9...a2de",
    "amount": 2000,
    "currency": "USDC",
    "chain": "base",
    "interval": 2592000,
    "subscriberAddress": "0x82A9...a2de",
    "merchantAddress": "0xAeB3...8934",
    "txHash": "0xfea3...d4c2",
    "metadata": { "orderId": "42", "plan": "pro" }
  }
}`}</CodeBlock>
      <p className="text-sm leading-relaxed text-foreground-muted">
        <code>interval</code> is the charge period in <strong>seconds</strong>,
        not a string like <code>&quot;monthly&quot;</code>. A 30-day subscription is{" "}
        <code>2592000</code>.
      </p>

      <SubsectionHeading>subscription.charged</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent when a recurring subscription charge is successfully processed by
        the keeper. Fires on every successful charge after the initial one.
      </p>
      <CodeBlock language="json">{`{
  "event": "subscription.charged",
  "timestamp": "2026-05-10T18:23:05.166Z",
  "data": {
    "subscriptionId": "3a1f...",
    "onChainId": "17",
    "paymentId": "8c44...",
    "amount": 2000,
    "fee": 10,
    "txHash": "0xabc1...ef02",
    "nextChargeDate": "2026-06-09T18:23:05.166Z",
    "metadata": { "orderId": "42", "plan": "pro" }
  }
}`}</CodeBlock>

      <SubsectionHeading>subscription.past_due</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent when a recurring charge fails (e.g. insufficient USDC balance or
        allowance exhausted). The subscription is still on record but will not
        auto-recover.
      </p>
      <CodeBlock language="json">{`{
  "event": "subscription.past_due",
  "timestamp": "2026-05-10T18:23:05.166Z",
  "data": {
    "subscriptionId": "3a1f...",
    "onChainId": "17",
    "status": "past_due",
    "metadata": { "orderId": "42", "plan": "pro" }
  }
}`}</CodeBlock>

      <SubsectionHeading>subscription.cancelled</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent when a subscription is cancelled, either by the merchant or the
        customer.
      </p>
      <CodeBlock language="json">{`{
  "event": "subscription.cancelled",
  "timestamp": "2026-05-10T18:23:05.166Z",
  "data": {
    "subscriptionId": "3a1f...",
    "onChainId": "17",
    "status": "cancelled",
    "metadata": { "orderId": "42", "plan": "pro" }
  }
}`}</CodeBlock>

      <SubsectionHeading>subscription.trial_started</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent the moment a customer finishes a trial-enabled checkout. The
        subscription exists only off-chain at this stage — no USDC has moved,
        no contract call has run. Subscribe if you want to provision access
        up-front.
      </p>
      <CodeBlock language="json">{`{
  "event": "subscription.trial_started",
  "timestamp": "2026-04-10T18:23:05.166Z",
  "data": {
    "subscriptionId": "3a1f...",
    "checkoutId": "chk_abc",
    "productId": "prod_xyz",
    "customerId": "cust_123",
    "subscriberAddress": "0x1234...",
    "trialEndsAt": "2026-04-17T18:23:05.166Z",
    "metadata": { "orderId": "42" }
  }
}`}</CodeBlock>

      <SubsectionHeading>subscription.trial_ending</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent once per trial, when the trial is within 3 days of expiring.
        Pairs with the keeper-driven reminder email; subscribe if you want to
        send your own in-app nudge before conversion.
      </p>
      <CodeBlock language="json">{`{
  "event": "subscription.trial_ending",
  "timestamp": "2026-04-16T18:23:05.166Z",
  "data": {
    "subscriptionId": "3a1f...",
    "productId": "prod_xyz",
    "customerId": "cust_123",
    "subscriberAddress": "0x1234...",
    "trialEndsAt": "2026-04-17T18:23:05.166Z",
    "metadata": { "orderId": "42" }
  }
}`}</CodeBlock>

      <SubsectionHeading>subscription.trial_converted</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent when the keeper replays the stored signatures and the contract
        emits <code>SubscriptionCreated</code>, flipping the row from
        <code> trialing</code> to <code>active</code>. A
        <code> subscription.created</code> event fires immediately after with
        the full on-chain subscription payload.
      </p>
      <CodeBlock language="json">{`{
  "event": "subscription.trial_converted",
  "timestamp": "2026-04-17T18:23:05.166Z",
  "data": {
    "subscriptionId": "3a1f...",
    "onChainId": "17",
    "subscriberAddress": "0x1234...",
    "merchantAddress": "0xabcd...",
    "txHash": "0xdead..."
  }
}`}</CodeBlock>

      <SubsectionHeading>subscription.trial_cancelled</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent when a trialing subscription is cancelled before it converts —
        either by the merchant via the dashboard or by the customer via the
        portal. <code>cancelledBy</code> distinguishes the two.
      </p>
      <CodeBlock language="json">{`{
  "event": "subscription.trial_cancelled",
  "timestamp": "2026-04-14T18:23:05.166Z",
  "data": {
    "subscriptionId": "3a1f...",
    "productId": "prod_xyz",
    "customerId": "cust_123",
    "subscriberAddress": "0x1234...",
    "trialEndsAt": "2026-04-17T18:23:05.166Z",
    "cancelledBy": "customer",
    "cancelledAt": "2026-04-14T18:23:05.166Z",
    "metadata": { "orderId": "42" }
  }
}`}</CodeBlock>

      <SubsectionHeading>invoice.issued</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent the moment an invoice is created — always inside the same
        database transaction that records the payment, so you can trust that
        by the time this fires the payment is committed and queryable.
        Subscribe if you want to run accounting automations, push invoices
        to an external ledger, or notify your internal team.
      </p>
      <CodeBlock language="json">{`{
  "event": "invoice.issued",
  "timestamp": "2026-04-11T18:23:05.166Z",
  "data": {
    "invoiceId": "8b2c...",
    "invoiceNumber": "INV-000042",
    "paymentId": "1f23...",
    "customerId": "cust_xyz",
    "totalCents": 1200,
    "subtotalCents": 1000,
    "taxCents": 200,
    "taxLabel": "VAT 20%",
    "currency": "USDC",
    "hostedUrl": "https://paylix.example.com/i/abc...",
    "invoicePdfUrl": "https://paylix.example.com/i/abc.../pdf",
    "receiptPdfUrl": "https://paylix.example.com/i/abc.../receipt",
    "metadata": { "orderId": "42" }
  }
}`}</CodeBlock>

      <SubsectionHeading>invoice.email_sent</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent after the invoice email is successfully delivered to the
        buyer via the configured mailer driver (Resend or SMTP).
      </p>
      <CodeBlock language="json">{`{
  "event": "invoice.email_sent",
  "timestamp": "2026-04-11T18:23:08.011Z",
  "data": {
    "invoiceId": "8b2c...",
    "invoiceNumber": "INV-000042",
    "to": "customer@example.com"
  }
}`}</CodeBlock>

      <SubsectionHeading>invoice.email_failed</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent when the mailer fails to deliver an invoice email. This is
        the actionable one — subscribe to it and alert the merchant, or
        auto-retry from your own side. The invoice row itself is always
        created regardless of email outcome, so the customer can still
        access it via the hosted link.
      </p>
      <CodeBlock language="json">{`{
  "event": "invoice.email_failed",
  "timestamp": "2026-04-11T18:23:08.011Z",
  "data": {
    "invoiceId": "8b2c...",
    "invoiceNumber": "INV-000042",
    "to": "customer@example.com",
    "error": "SMTP 550: mailbox full"
  }
}`}</CodeBlock>

      <SubsectionHeading>system.relayer_balance_low</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent when the gasless payments relayer wallet&apos;s ETH balance drops
        below 0.001 ETH. Fires once per threshold crossing (debounced), so you
        get alerted when the balance first goes low — not repeatedly. Subscribe
        to this event if you&apos;re running gasless payments and want to know
        before the relayer runs out of gas for user transactions.
      </p>
      <CodeBlock language="json">{`{
  "event": "system.relayer_balance_low",
  "timestamp": "2026-04-10T18:23:05.166Z",
  "data": {
    "address": "0xC7beA00CfCFb3f93AE8555d1a9E1Ec3018F281F9",
    "balanceWei": "800000000000000",
    "balanceEth": "0.0008",
    "thresholdWei": "1000000000000000"
  }
}`}</CodeBlock>

      <SubsectionHeading>system.keeper_balance_low</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent when the subscription keeper wallet&apos;s ETH balance drops
        below 0.001 ETH. Same debouncing as the relayer alert. Subscribe if
        you have subscriptions running — the keeper wallet pays gas for
        every recurring charge.
      </p>
      <CodeBlock language="json">{`{
  "event": "system.keeper_balance_low",
  "timestamp": "2026-04-10T18:23:05.166Z",
  "data": {
    "address": "0x950d809e392FA0f080318d896c80472531f01907",
    "balanceWei": "750000000000000",
    "balanceEth": "0.00075",
    "thresholdWei": "1000000000000000"
  }
}`}</CodeBlock>

      <SubsectionHeading>system.keeper_failure_rate_high</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Fires when more than 20% of attempted subscription charges fail
        in the last 15 minutes (min 5 attempts). Debounced to at most
        once per hour. Investigate relayer gas, RPC health, or a run of
        insufficient-balance buyers.
      </p>
      <CodeBlock language="json">{`{
  "event": "system.keeper_failure_rate_high",
  "data": { "failed": 8, "total": 22, "rate": 0.36, "windowMinutes": 15 }
}`}</CodeBlock>

      <SubsectionHeading>system.webhook_failure_rate_high</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Fires when more than 30% of webhook deliveries failed in the last
        60 minutes (min 10 deliveries). Typically indicates a merchant
        endpoint outage or a breaking change you pushed that broke
        receiver validation.
      </p>
      <CodeBlock language="json">{`{
  "event": "system.webhook_failure_rate_high",
  "data": { "failed": 40, "total": 100, "rate": 0.4, "windowMinutes": 60 }
}`}</CodeBlock>

      <SubsectionHeading>system.unmatched_retry_queue_deep</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Fires when the indexer&apos;s unmatched-event retry queue has
        more than 50 rows older than 10 minutes. Usually means a batch
        of on-chain events arrived before the matching DB rows —
        investigate the apps/web → indexer write path.
      </p>
      <CodeBlock language="json">{`{
  "event": "system.unmatched_retry_queue_deep",
  "data": { "pending": 73, "olderThanMinutes": 10 }
}`}</CodeBlock>

      <SubsectionHeading>system.trial_conversion_failure_rate_high</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Fires when more than 25% of trials that reached a terminal
        state (active or trial_conversion_failed) in the last 24 hours
        failed to convert (min 3). Often a signal that wallet-history
        or email checks are too strict, or that relayer gas is running
        out mid-conversion.
      </p>
      <CodeBlock language="json">{`{
  "event": "system.trial_conversion_failure_rate_high",
  "data": { "failed": 4, "total": 12, "rate": 0.33, "windowHours": 24 }
}`}</CodeBlock>

      <SubsectionHeading>coupon.redeemed</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Sent when a coupon is successfully applied to a one-time payment and
        the on-chain charge settles. Counts toward the coupon&apos;s redemption
        total; the redemption row is persisted in{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          coupon_redemptions
        </code>.
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

      <SectionHeading>Replay a past delivery</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Every webhook delivery is stored, including failures. Open{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          /dashboard/webhooks
        </code>
        , select an endpoint, and click <strong>Replay</strong> on any
        delivery row. A new delivery is created — the original row is never
        mutated — and re-signed with the endpoint&apos;s current secret, so
        replay works correctly even across rotations. Rate-limited to 10
        replays/min/webhook.
      </p>

      <SectionHeading>Send a test event</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The <strong>Send Test</strong> modal dispatches a synthetic event for
        any event type the endpoint is subscribed to. Test events carry{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          livemode: false
        </code>{" "}
        and an{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          event_id
        </code>{" "}
        prefixed with{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          evt_test_
        </code>{" "}
        — receivers should filter these out of production handlers. Rate-limited
        to 20 test events/min/org.
      </p>

      <SectionHeading>Best Practices</SectionHeading>
      <ul className="mt-4 space-y-2 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          <strong className="text-foreground">Always verify signatures</strong>{" "}
          before processing events. Never trust unverified payloads.
        </li>
        <li>
          <strong className="text-foreground">Return 200 quickly</strong>. Do
          heavy processing asynchronously. Paylix retries on non-2xx responses.
        </li>
        <li>
          <strong className="text-foreground">Handle duplicates</strong>. Use
          the{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            paymentId
          </code>{" "}
          or{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            subscriptionId
          </code>{" "}
          for idempotency.
        </li>
        <li>
          <strong className="text-foreground">Use raw body</strong> for
          signature verification. Parsed JSON bodies will fail verification.
        </li>
      </ul>
    </>
  );
}
