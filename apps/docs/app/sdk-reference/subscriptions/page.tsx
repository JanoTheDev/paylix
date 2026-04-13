import type { Metadata } from "next";
import {
  CodeBlock,
  DocTable,
  DocTableBody,
  DocTableHead,
  DocTableHeader,
  DocTableRow,
  PageHeading,
  ParamRow,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Subscriptions — SDK Reference" };

export default function SubscriptionsReference() {
  return (
    <>
      <PageHeading
        title="Subscriptions"
        description="Create, cancel, list, and manage recurring subscriptions."
      />

      <SectionHeading>paylix.createSubscription()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Creates a recurring subscription checkout session.
      </p>
      <CodeBlock language="ts">{`paylix.createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult>`}</CodeBlock>

      <SubsectionHeading>Parameters</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Parameter</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="productId" type="string" required description="ID of the subscription product." />
          <ParamRow name="customerId" type="string" description="Your customer identifier." />
          <ParamRow name="successUrl" type="string" description="Redirect URL after successful setup." />
          <ParamRow name="cancelUrl" type="string" description="Redirect URL if the customer cancels." />
          <ParamRow name="metadata" type="Record<string, string>" description="Arbitrary key-value data." />
        </DocTableBody>
      </DocTable>

      <SubsectionHeading>Returns</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Field</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="checkoutUrl" type="string" description="Hosted checkout page URL." />
          <ParamRow name="checkoutId" type="string" description="Checkout session identifier." />
          <ParamRow name="trialEndsAt" type="string | null" description="ISO-8601 timestamp if the product has a trial period." />
        </DocTableBody>
      </DocTable>

      <CodeBlock language="ts">{`const { checkoutUrl, checkoutId } = await paylix.createSubscription({
  productId: "prod_monthly_pro",
  customerId: "cust_xyz",
  successUrl: "https://example.com/welcome",
  cancelUrl: "https://example.com/pricing",
});`}</CodeBlock>

      <SectionHeading>paylix.cancelSubscription()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Cancels a subscription on-chain via the Paylix relayer. The merchant
        signs nothing and pays no gas — the promise only resolves after the
        on-chain transaction has been mined.
      </p>
      <CodeBlock language="ts">{`paylix.cancelSubscription(params: { subscriptionId: string }): Promise<void>`}</CodeBlock>
      <CodeBlock language="ts">{`await paylix.cancelSubscription({
  subscriptionId: "sub_abc123",
});`}</CodeBlock>

      <SectionHeading>paylix.updateSubscriptionWallet()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Requests a wallet migration for a subscription. The new wallet owner
        must call{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          acceptSubscriptionWalletUpdate
        </code>{" "}
        on the SubscriptionManager contract to complete the migration.
      </p>
      <CodeBlock language="ts">{`paylix.updateSubscriptionWallet(params: {
  subscriptionId: string;
  newWallet: string;
}): Promise<void>`}</CodeBlock>

      <SubsectionHeading>Parameters</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Parameter</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="subscriptionId" type="string" required description="ID of the subscription to update." />
          <ParamRow name="newWallet" type="string" required description="Ethereum address of the new paying wallet (0x-prefixed, 42 chars)." />
        </DocTableBody>
      </DocTable>

      <CodeBlock language="ts">{`await paylix.updateSubscriptionWallet({
  subscriptionId: "sub_abc123",
  newWallet: "0x1234567890abcdef1234567890abcdef12345678",
});`}</CodeBlock>

      <SectionHeading>paylix.listSubscriptions()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Lists subscriptions for the authenticated organization. Supports
        filtering by customer ID, status, or metadata. Every result includes
        an embedded{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          customer
        </code>{" "}
        object.
      </p>
      <CodeBlock language="ts">{`paylix.listSubscriptions(params?: ListSubscriptionsParams): Promise<SubscriptionSummary[]>`}</CodeBlock>

      <SubsectionHeading>Filter Parameters</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Parameter</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="customerId" type="string" description="Filter by customer ID." />
          <ParamRow name="status" type="SubscriptionStatus" description={`Filter by status (e.g. "active", "past_due", "cancelled").`} />
          <ParamRow name="metadata" type="Record<string, string>" description="Filter by metadata key-value pairs (AND logic)." />
          <ParamRow name="limit" type="number" description="Max results (1-100, default 100)." />
        </DocTableBody>
      </DocTable>

      <SubsectionHeading>SubscriptionSummary</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Field</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="id" type="string" description="Subscription ID." />
          <ParamRow name="status" type="SubscriptionStatus" description="Current status (active, past_due, cancelled, etc.)." />
          <ParamRow name="subscriberAddress" type="string" description="Wallet address of the subscriber." />
          <ParamRow name="networkKey" type="string" description="Network key (e.g. base, base-sepolia)." />
          <ParamRow name="tokenSymbol" type="string" description="Token symbol (e.g. USDC)." />
          <ParamRow name="onChainId" type="string | null" description="On-chain subscription ID." />
          <ParamRow name="intervalSeconds" type="number | null" description="Charge interval in seconds." />
          <ParamRow name="nextChargeDate" type="string | null" description="ISO-8601 timestamp of the next charge." />
          <ParamRow name="trialEndsAt" type="string | null" description="ISO-8601 timestamp when the trial ends." />
          <ParamRow name="pausedAt" type="string | null" description="ISO-8601 timestamp when paused." />
          <ParamRow name="productId" type="string" description="Product identifier." />
          <ParamRow name="productName" type="string" description="Human-readable product name." />
          <ParamRow name="metadata" type="Record<string, string>" description="Custom key-value metadata." />
          <ParamRow name="livemode" type="boolean" description="Whether this is a live-mode subscription." />
          <ParamRow name="createdAt" type="string" description="ISO-8601 creation timestamp." />
          <ParamRow name="customer" type="CustomerInfo" description="Embedded customer: id, email, firstName, lastName, walletAddress." />
        </DocTableBody>
      </DocTable>

      <CodeBlock language="ts">{`// List active subscriptions
const active = await paylix.listSubscriptions({ status: "active" });

// Find subscriptions by your own user ID stored in metadata
const userSubs = await paylix.listSubscriptions({
  metadata: { userId: "user_123" },
});

// Access customer info
for (const sub of active) {
  console.log(sub.productName, sub.customer.email, sub.nextChargeDate);
}`}</CodeBlock>

      <SectionHeading>paylix.getSubscription()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Retrieves a single subscription by ID, including the embedded customer object.
      </p>
      <CodeBlock language="ts">{`paylix.getSubscription(id: string): Promise<SubscriptionSummary>`}</CodeBlock>
      <CodeBlock language="ts">{`const sub = await paylix.getSubscription("sub_abc123");
console.log(sub.status, sub.nextChargeDate);
console.log("Customer:", sub.customer.email, sub.customer.walletAddress);`}</CodeBlock>
    </>
  );
}
