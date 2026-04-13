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
