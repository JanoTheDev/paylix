import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Products API" };

export default function ProductsPage() {
  return (
    <>
      <PageHeading
        title="Products API"
        description="Products define what you sell. Each product has a type, price, and optional billing interval. Create and manage them via the SDK or the dashboard."
      />

      <SectionHeading>Product types</SectionHeading>
      <ul className="mt-4 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            one_time
          </code>{" "}
          — a single payment with no recurrence
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            subscription
          </code>{" "}
          — recurring charges on a billing interval
        </li>
      </ul>

      <SectionHeading>Billing intervals</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Subscription products support the following intervals:
      </p>
      <ul className="mt-4 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            minutely
          </code>{" "}
          — for testing only
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            weekly
          </code>
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            biweekly
          </code>
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            monthly
          </code>
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            quarterly
          </code>
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            yearly
          </code>
        </li>
      </ul>

      <SectionHeading>Prices</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Products support multi-currency pricing via a{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          prices
        </code>{" "}
        array. Each entry specifies a network, token, and amount in native
        token units.
      </p>
      <CodeBlock language="ts">{`prices: [
  { networkKey: "base", tokenSymbol: "USDC", amount: "10.00" },
  { networkKey: "base-sepolia", tokenSymbol: "USDC", amount: "10.00" },
]`}</CodeBlock>

      <Callout variant="info" title="Product prices are decimal strings">
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          prices[].amount
        </code>{" "}
        is a decimal string in the token&apos;s own units, not cents. For USDC,{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          &quot;10.00&quot;
        </code>{" "}
        means 10 USDC. Integer cents apply to other surfaces — payment amounts,
        refunds, and coupon discounts — but not to product prices.
      </Callout>

      <SectionHeading>Trial support</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Set{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          trialDays
        </code>{" "}
        or{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          trialMinutes
        </code>{" "}
        (testing) on subscription products to enable free trials. Email
        collection is automatically required for trial-enabled products.
      </p>

      <SectionHeading>Checkout fields</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Configure which fields to collect from the buyer at checkout:{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          firstName
        </code>
        ,{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          lastName
        </code>
        ,{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          email
        </code>
        ,{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          phone
        </code>
        .
      </p>

      <SectionHeading>SDK methods</SectionHeading>

      <SubsectionHeading>Create a product</SubsectionHeading>
      <CodeBlock language="ts">{`const product = await paylix.createProduct({
  name: "Pro Plan",
  type: "subscription",
  billingInterval: "monthly",
  prices: [
    { networkKey: "base", tokenSymbol: "USDC", amount: "20.00" },
  ],
  trialDays: 14,
  checkoutFields: { email: true, firstName: true, lastName: true },
});`}</CodeBlock>

      <SubsectionHeading>Update a product</SubsectionHeading>
      <CodeBlock language="ts">{`const updated = await paylix.updateProduct("prod_abc123", {
  name: "Pro Plan v2",
  trialDays: 7,
});`}</CodeBlock>

      <SubsectionHeading>List products</SubsectionHeading>
      <CodeBlock language="ts">{`const products = await paylix.listProducts();

// There is no getProduct — find the one you need from the list.
const product = products.find((p) => p.id === "prod_abc123");`}</CodeBlock>
    </>
  );
}
