import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "API Changelog" };

export default function ChangelogPage() {
  return (
    <>
      <PageHeading
        title="API Changelog"
        description={
          <>
            Every API response includes an{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
              x-paylix-version
            </code>{" "}
            header with the current API version (calver date). Breaking changes
            bump the version.
          </>
        }
      />

      <SectionHeading>2026-04-22</SectionHeading>

      <SubsectionHeading>CSV export</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        <code>GET /api/{"{payments,subscriptions,invoices,customers}"}/export</code>{" "}
        emits mode-scoped CSVs with RFC 4180 escaping, ISO 8601 dates,
        and dynamically expanded <code>metadata.&lt;key&gt;</code> columns.
        50,000-row cap per download with an{" "}
        <code>X-Paylix-Truncated</code> header. Dashboard Export buttons
        on Payments and Customers.
      </p>

      <SubsectionHeading>Scheduled cancellation</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        <code>POST /api/subscriptions/:id/cancel</code> now accepts{" "}
        <code>{'{ when: "immediate" | "period_end" }'}</code>. Period-end
        keeps the sub <code>active</code> until{" "}
        <code>next_charge_date</code>; the keeper flips to{" "}
        <code>cancelled</code> at the boundary and fires{" "}
        <code>subscription.cancelled</code> with{" "}
        <code>reason: "scheduled"</code>. Customers can undo via the
        portal before the boundary.
      </p>

      <SubsectionHeading>Gift subscriptions</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        New <code>POST /api/subscriptions/gift</code> and{" "}
        <code>paylix.giftSubscription()</code> create off-chain subs
        with no wallet, no USDC, no contract call. Optional{" "}
        <code>expiresAt</code>; keeper flips to cancelled when it
        passes. Blocklist still applies.
      </p>

      <SubsectionHeading>Admin overrides</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Three new support endpoints:{" "}
        <code>POST /api/subscriptions/:id/extend-trial {"{ days }"}</code>{" "}
        bumps trial_ends_at and revives failed-conversion subs;{" "}
        <code>POST /api/subscriptions/:id/comp-charge</code> forgives
        the current past-due cycle with a zero-dollar payment row;{" "}
        <code>POST /api/subscriptions/:id/reschedule {"{ nextChargeDate }"}</code>{" "}
        absolute-overrides next charge within one interval of current
        period end. All recorded to the audit log. SDK:{" "}
        <code>paylix.extendTrial</code>, <code>paylix.compCharge</code>,{" "}
        <code>paylix.rescheduleSubscription</code>.
      </p>

      <SubsectionHeading>Operator alerts</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Indexer alerts loop emits four new <code>system.*</code> events
        alongside the existing balance-low pair:{" "}
        <code>keeper_failure_rate_high</code>,{" "}
        <code>webhook_failure_rate_high</code>,{" "}
        <code>unmatched_retry_queue_deep</code>,{" "}
        <code>trial_conversion_failure_rate_high</code>. Debounced to at
        most one fire per hour via system_status markers.
      </p>

      <SubsectionHeading>Audit log filter + search</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        <code>/api/settings/audit-log</code> accepts{" "}
        <code>action</code>, <code>resourceType</code>,{" "}
        <code>resourceId</code>, <code>userId</code>, <code>from</code>,{" "}
        <code>to</code>, and free-text <code>q</code>. Response carries{" "}
        <code>distinctActions</code> + <code>distinctResourceTypes</code> +{" "}
        <code>nextCursor</code>. Dashboard page adds search, action
        dropdown, date range, and debounced live refetch.
      </p>

      <SubsectionHeading>Idempotency on refund + gift</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        <code>POST /api/payments/:id/refund</code> and{" "}
        <code>POST /api/subscriptions/gift</code> honor the{" "}
        <code>Idempotency-Key</code> header — retries with the same key
        return the cached response instead of double-executing.
      </p>

      <SubsectionHeading>Webhook signature replay protection</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Web + indexer dispatchers now emit{" "}
        <code>x-paylix-signature: t=&lt;unix&gt;,v1=&lt;hmac&gt;</code>.
        The HMAC covers <code>&lt;unix_seconds&gt;.&lt;body&gt;</code>.
        SDK <code>webhooks.verify</code> accepts the timestamped form
        and rejects signatures more than 5 minutes old. Legacy{" "}
        <code>sha256=</code> format still validates for backwards
        compatibility and is flagged for removal in a future major.
      </p>

      <SubsectionHeading>Seats / quantity pricing</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Products gain <code>allowQuantity</code> / <code>minQuantity</code> /{" "}
        <code>maxQuantity</code>. Checkout + subscription APIs accept{" "}
        <code>quantity</code>; session amount scales linearly. Subscription
        + payment rows record the quantity for bookkeeping. Migration 0025.
      </p>

      <SubsectionHeading>Refunds</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        New <code>POST /api/payments/:id/refund</code> +{" "}
        <code>paylix.refundPayment()</code>. Merchant sends USDC back to
        the buyer from their own wallet; Paylix fetches the receipt,
        decodes the Transfer log, and verifies the merchant → buyer
        transfer before recording. Partial + cumulative refunds
        supported. Webhook: <code>payment.refunded</code>. The 0.5%
        platform fee is <strong>not</strong> returned — merchant bears
        the full refund amount.
      </p>

      <SubsectionHeading>Coupons — subscription once + repeating</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        <code>SubscriptionManager</code> gains{" "}
        <code>createSubscriptionWithPermitDiscount</code> and a new{" "}
        <code>SubscriptionIntentDiscount</code> EIP-712 typehash. The
        contract stores a per-subscription discount amount and cycle
        counter in a <code>subscriptionDiscounts</code> side mapping;{" "}
        <code>_processPayment</code> applies the discount for each of the
        first N charges and decrements. Buyer&apos;s signed intent now
        commits to <code>discountAmount</code> and{" "}
        <code>discountCycles</code>, so a compromised relayer cannot swap
        them. Contract redeploy required; Foundry coverage under{" "}
        <code>SubscriptionManagerDiscount.t.sol</code>.
      </p>

      <SubsectionHeading>Coupons</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Merchant-managed discount codes. Create percent or fixed-amount
        coupons from{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          /dashboard/coupons
        </code>{" "}
        or via the SDK; buyers enter them on the hosted checkout. Apply
        mutates <code>session.amount</code> and preserves the original on
        <code> subtotalAmount</code>. Fires a new{" "}
        <code>coupon.redeemed</code> webhook after the on-chain charge
        settles. One-time payments only in this release.
      </p>

      <SubsectionHeading>Payment Links</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Permanent URLs (<code>/pay/:linkId</code>) that spawn a fresh
        checkout session on every visit. Useful for socials and link-in-
        bio. Enforces <code>max_redemptions</code> atomically and can
        pre-lock to a specific (network, token).
      </p>

      <SubsectionHeading>Analytics dashboard</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        MRR, revenue, active subscribers, failed-charge rate, and ARPU
        at <code>/dashboard/analytics</code>. Range picker 7d / 30d /
        90d. Backed by <code>GET /api/analytics</code> with a 5-minute
        private cache.
      </p>

      <SubsectionHeading>Webhook replay + send test</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Replay any past delivery from the dashboard or SDK. Send a
        synthetic event for any subscribed event type. Test events carry
        <code> livemode: false</code> and an{" "}
        <code>event_id</code> prefixed with <code>evt_test_</code>.
      </p>

      <SubsectionHeading>Abandonment recovery</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Indexer tick emails a recovery link to buyers who left their
        checkout with an email submitted and sat idle for 60+ minutes.
        Gated by a new <code>checkoutRecovery</code> notification toggle.
      </p>

      <SubsectionHeading>Email branding</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Every outbound email now renders the merchant logo, legal name,
        support email, and invoice footer via a shared{" "}
        <code>BrandedEmail</code> wrapper. Empty profile fields fall back
        to default Paylix branding.
      </p>

      <SubsectionHeading>Blocklist</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Block wallets, emails (full address or domain), or countries per
        org from <code>/dashboard/blocklist</code>. Enforced in the relay
        path with a generic 403 <code>blocked</code> response.
      </p>

      <SubsectionHeading>API key rotation</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Rotate a key on the same id and keep the old secret valid for a
        grace window (none / 24h / 7d). Auth middleware accepts either
        the current hash or the previous hash until{" "}
        <code>expires_at</code>.
      </p>

      <SubsectionHeading>Trial email + webhook lifecycle</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Four trial webhook events (
        <code>subscription.trial_started</code>,{" "}
        <code>trial_ending</code>, <code>trial_converted</code>,{" "}
        <code>trial_cancelled</code>) now fire end-to-end. New{" "}
        <code>trial-converted</code> receipt email sent on the first real
        charge after conversion.
      </p>

      <SubsectionHeading>Checkout restart route</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        <code>/checkout/restart/:sessionId</code> resumes live sessions
        and clones expired/completed ones. Used by the abandonment
        recovery email and surfaced on failed trial conversions.
      </p>

      <SubsectionHeading>Indexer observability</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The unmatched-event retry loop emits a structured JSON log each
        pass (<code>unmatched_retry_pass</code>) with pending / retried /
        matched counts and p95 age, plus a warning when depth exceeds
        50 or oldest age exceeds 5 minutes.
      </p>

      <SectionHeading>2026-04-12</SectionHeading>

      <SubsectionHeading>Test mode and live mode</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Paylix now ships two fully isolated environments: test mode (Base Sepolia
        + MockUSDC) and live mode (Base mainnet + real USDC). All data — products,
        customers, subscriptions, payments, invoices, webhooks, API keys — is
        scoped by mode and never crosses over.
      </p>
      <ul className="mt-3 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          API keys now carry explicit mode prefixes:{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            pk_test_
          </code>
          {" / "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            sk_test_
          </code>
          {" / "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            pk_live_
          </code>
          {" / "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            sk_live_
          </code>
          . The mode is locked to the key prefix — no additional config needed.
        </li>
        <li>
          Test keys get a 2.5x rate limit bonus: 500 req/min publishable, 250
          req/min secret (live keys: 200 / 100).
        </li>
        <li>
          All resource responses (products, customers, payments, subscriptions,
          invoices, webhooks, checkout links, API keys) now include a top-level{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            livemode: boolean
          </code>{" "}
          field.
        </li>
        <li>
          Webhook event envelopes include{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            livemode
          </code>{" "}
          at the top level. HMAC signatures cover it, so tampering is detectable.
        </li>
      </ul>
      <CodeBlock language="json">{`{
  "event": "payment.confirmed",
  "timestamp": "2026-04-12T12:00:00Z",
  "livemode": false,
  "data": { "id": "pay_...", "amount": 1000, "currency": "USDC" }
}`}</CodeBlock>
      <CodeBlock language="ts">{`app.post("/webhook", async (req, res) => {
  const webhook = req.body;
  if (!webhook.livemode) {
    console.log(\`[TEST] \${webhook.event}\`);
    return res.status(200).send();
  }
  await handleLiveEvent(webhook);
  res.status(200).send();
});`}</CodeBlock>
      <p className="mt-3 text-sm leading-relaxed text-foreground-muted">
        See{" "}
        <a href="/test-mode" className="text-primary hover:underline">
          Test Mode
        </a>{" "}
        for the full guide including the going-live checklist.
      </p>

      <SubsectionHeading>Test-mode faucet</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Test-mode wallets need MockUSDC to complete a checkout. Paylix now
        provides a faucet so you don&apos;t need Foundry to fund test wallets.
      </p>
      <ul className="mt-3 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          New SDK method{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            paylix.testFaucet({"{ address, amount? }"})
          </code>{" "}
          mints MockUSDC to any wallet. Requires a{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            sk_test_
          </code>{" "}
          key — calling it with a live key throws immediately.
        </li>
        <li>
          The test-mode checkout page shows a{" "}
          <strong className="text-foreground">Fund test wallet</strong> button
          inline when the connected wallet has insufficient balance.
        </li>
        <li>
          Rate limits: 1 mint per wallet per 24h, max 1000 MockUSDC per request,
          10 faucet calls per minute per API key, 100 000 MockUSDC global daily
          cap.
        </li>
      </ul>
      <CodeBlock language="ts">{`import { Paylix } from "@paylix/sdk";
const paylix = new Paylix({ apiKey: "sk_test_..." });

await paylix.testFaucet({ address: "0xabc..." });
// Mints 1000 MockUSDC to the address`}</CodeBlock>

      <SubsectionHeading>Idempotency keys</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Write endpoints now accept an{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          Idempotency-Key
        </code>{" "}
        header. Retrying the same request with the same key returns the cached
        response instead of creating a duplicate. Retrying with the same key but
        a different body returns{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          409 idempotency_key_reused
        </code>
        .
      </p>
      <ul className="mt-3 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          Supported endpoints:{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            POST /api/checkout
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            POST /api/products
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            POST /api/customers
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            POST /api/webhooks
          </code>
        </li>
        <li>Keys are scoped per organization and expire after 24 hours. Max length: 255 characters.</li>
      </ul>
      <CodeBlock language="ts">{`const res = await fetch("/api/checkout", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_test_...",
    "Content-Type": "application/json",
    "Idempotency-Key": "order-2026-04-12-001",
  },
  body: JSON.stringify({ productId: "prod_..." }),
});`}</CodeBlock>

      <SubsectionHeading>Subscription pause and resume</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Subscriptions can now be paused and resumed without canceling. Pause is
        DB-only — no on-chain transaction is required. The keeper skips paused
        subscriptions, and resume shifts{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          nextChargeDate
        </code>{" "}
        forward by the paused duration so customers aren&apos;t billed for time
        they couldn&apos;t use.
      </p>
      <ul className="mt-3 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          New merchant routes:{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            POST /api/subscriptions/{"{id}"}/pause
          </code>{" "}
          and{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            POST /api/subscriptions/{"{id}"}/resume
          </code>
        </li>
        <li>
          New customer portal routes:{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            POST /api/portal/pause-subscription
          </code>{" "}
          and{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            POST /api/portal/resume-subscription
          </code>
        </li>
        <li>
          Trust enforcement: a subscription paused by the merchant can only be
          resumed by the merchant, and vice versa for customer-initiated pauses.
          Cross-party resume returns{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            403 paused_by_other_party
          </code>
          .
        </li>
        <li>
          Subscription status now includes{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            paused
          </code>{" "}
          alongside the existing values:{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            active
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            past_due
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            cancelled
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            expired
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            trialing
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            trial_conversion_failed
          </code>
          .
        </li>
      </ul>

      <SubsectionHeading>Smart retries and dunning</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Failed subscription charges now follow an automatic retry schedule
        instead of immediately flipping to{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          past_due
        </code>
        .
      </p>
      <ul className="mt-3 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>Retry schedule: +1 day, +3 days, +7 days after first failure.</li>
        <li>
          After 3 consecutive failures the subscription moves to{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            past_due
          </code>{" "}
          and a past-due reminder email fires.
        </li>
        <li>
          Subscriptions in{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            past_due
          </code>{" "}
          for more than 14 days are automatically cancelled by the indexer.
        </li>
        <li>
          New columns on subscription rows:{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            chargeFailureCount
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            lastChargeError
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            lastChargeAttemptAt
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            pastDueSince
          </code>
          .
        </li>
      </ul>

      <Callout variant="info" title="Webhook events for dunning">
        The existing{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          subscription.past_due
        </code>{" "}
        event fires when the subscription flips status after the third failure.
        Listen to it to trigger your own recovery flow (customer email, grace
        period, etc.).
      </Callout>

      <SubsectionHeading>Earlier additions (same date)</SubsectionHeading>
      <ul className="mt-3 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          Free trial support (
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            trialDays
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            trialMinutes
          </code>{" "}
          on products). See{" "}
          <a href="/free-trials" className="text-primary hover:underline">
            Free Trials
          </a>
          .
        </li>
        <li>
          Customer CRUD added to SDK (
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            createCustomer
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            getCustomer
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            updateCustomer
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            listCustomers
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            deleteCustomer
          </code>
          )
        </li>
        <li>
          Product CRUD added to SDK (
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            createProduct
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            getProduct
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            updateProduct
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            listProducts
          </code>
          )
        </li>
        <li>
          All API errors now return{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            {`{ error: { code, message } }`}
          </code>
        </li>
        <li>Per-API-key rate limiting, audit logging, webhook per-URL rate limiting, CSRF origin check</li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            x-paylix-version
          </code>{" "}
          response header added to all API responses
        </li>
      </ul>

      <SectionHeading>2026-04-01</SectionHeading>
      <ul className="mt-4 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>Initial release</li>
        <li>One-time payments and subscriptions</li>
        <li>Dashboard, checkout links, webhooks, API keys</li>
        <li>Self-hosting via Docker Compose</li>
      </ul>
    </>
  );
}
