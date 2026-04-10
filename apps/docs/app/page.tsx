import type { Metadata } from "next";
import {
  CodeBlock,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Getting Started" };

const nextSteps = [
  {
    href: "/sdk-reference",
    title: "SDK Reference",
    description: "Every method with full TypeScript signatures.",
  },
  {
    href: "/subscriptions",
    title: "Subscriptions",
    description: "Recurring USDC charges and on-chain cancellation.",
  },
  {
    href: "/webhooks",
    title: "Webhooks",
    description: "Event payloads and signature verification.",
  },
  {
    href: "/self-hosting",
    title: "Self-Hosting",
    description: "Run Paylix on your own infrastructure with Docker.",
  },
];

export default function GettingStarted() {
  return (
    <>
      <PageHeading
        title="Getting Started"
        description="Paylix lets you accept USDC payments and subscriptions on Base with a few lines of TypeScript. No custodial wallets, no payment processors — funds move directly from customer wallets to yours. Buyers don't need to hold ETH — the platform relayer pays gas on their behalf while USDC still flows directly from buyer to merchant."
      />

      <p className="text-sm leading-relaxed text-foreground-muted">
        This guide walks you through installing the SDK, creating your first
        checkout, verifying payments, and handling webhook events. It takes
        about five minutes.
      </p>

      <SectionHeading>1. Install the SDK</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Add{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          @paylix/sdk
        </code>{" "}
        to your project. The SDK is a standalone package — it has no workspace
        dependencies and only pulls in <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">viem</code>.
      </p>
      <CodeBlock language="bash">{`npm install @paylix/sdk`}</CodeBlock>

      <SectionHeading>2. Initialize the Client</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Create a Paylix instance with your API key. You can get your API key
        from{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          Settings → API Keys
        </code>{" "}
        in the dashboard. Use{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          sk_test_
        </code>{" "}
        keys on testnet and{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          sk_live_
        </code>{" "}
        on mainnet.
      </p>
      <CodeBlock language="ts">{`import { Paylix } from "@paylix/sdk";

const paylix = new Paylix({
  apiKey: "sk_live_...",
  network: "base",           // "base" or "base-sepolia"
  merchantWallet: "0xYourWalletAddress",
  backendUrl: "https://your-paylix-instance.com",
});`}</CodeBlock>

      <SectionHeading>3. Create a Checkout</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Create a one-time payment checkout and redirect your customer to the
        hosted checkout page. Paylix handles wallet connection, USDC approval,
        and transaction confirmation.
      </p>
      <CodeBlock language="ts">{`const { checkoutUrl, checkoutId } = await paylix.createCheckout({
  productId: "prod_abc123",
  customerId: "cust_xyz",        // optional
  successUrl: "https://example.com/success",
  cancelUrl: "https://example.com/cancel",
  metadata: { orderId: "42" },   // optional
});

// Redirect the user
window.location.href = checkoutUrl;`}</CodeBlock>

      <SectionHeading>4. Verify the Payment</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        After the customer completes payment, verify it server-side before
        fulfilling the order. Never trust a client-side redirect alone —
        always confirm with the backend.
      </p>
      <CodeBlock language="ts">{`const result = await paylix.verifyPayment({
  paymentId: "pay_abc123",
});

if (result.verified) {
  // Fulfill the order
  console.log("Payment confirmed:", result.txHash);
  console.log("Amount:", result.amount, "USDC");
}`}</CodeBlock>

      <SectionHeading>5. Handle Webhooks</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Set up a webhook endpoint to receive real-time payment events. Webhooks
        are the most reliable way to keep your system in sync with on-chain
        activity. See the{" "}
        <a href="/webhooks" className="text-primary hover:underline">
          Webhooks guide
        </a>{" "}
        for full details.
      </p>
      <CodeBlock language="ts">{`import { webhooks } from "@paylix/sdk";

// In your API route handler
const isValid = webhooks.verify({
  payload: requestBody,
  signature: req.headers["x-paylix-signature"],
  secret: "whsec_...",
});

if (isValid) {
  const event = JSON.parse(requestBody);
  switch (event.type) {
    case "payment.confirmed":
      // Fulfill order
      break;
    case "subscription.created":
      // Activate subscription
      break;
  }
}`}</CodeBlock>

      <SectionHeading>Next Steps</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        You have the basics. Dive deeper into the areas you need:
      </p>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {nextSteps.map((step) => (
          <a
            key={step.href}
            href={step.href}
            className="group rounded-lg border border-border bg-surface-1 p-5 transition-colors hover:border-border-strong hover:bg-surface-2"
          >
            <div className="text-sm font-semibold text-foreground">
              {step.title}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-foreground-muted">
              {step.description}
            </div>
          </a>
        ))}
      </div>
    </>
  );
}
