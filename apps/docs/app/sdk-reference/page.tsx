import type { Metadata } from "next";
import Link from "next/link";
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
} from "@/components/docs";

export const metadata: Metadata = { title: "SDK Reference" };

const sections = [
  {
    href: "/sdk-reference/checkout",
    title: "Checkout & Verification",
    description: "Create checkout sessions and verify payments on-chain.",
    methods: ["createCheckout()", "verifyPayment()"],
  },
  {
    href: "/sdk-reference/payments",
    title: "Payments",
    description: "List and retrieve payment records with filtering and customer info.",
    methods: ["listPayments()", "getPayment()"],
  },
  {
    href: "/sdk-reference/subscriptions",
    title: "Subscriptions",
    description: "Create, cancel, list, and manage recurring subscriptions.",
    methods: [
      "createSubscription()",
      "cancelSubscription()",
      "updateSubscriptionWallet()",
      "listSubscriptions()",
    ],
  },
  {
    href: "/sdk-reference/portal",
    title: "Customer Portal & Invoices",
    description: "Access customer data, create portal sessions, and list invoices.",
    methods: ["getCustomerPortal()", "createPortalSession()", "listCustomerInvoices()"],
  },
  {
    href: "/sdk-reference/webhooks",
    title: "Webhook Management",
    description: "Create, list, update, delete, replay, and test webhook endpoints. Verify signatures.",
    methods: [
      "listWebhooks()",
      "createWebhook()",
      "getWebhook()",
      "updateWebhook()",
      "deleteWebhook()",
      "replayWebhookDelivery()",
      "sendTestWebhook()",
      "webhooks.verify()",
    ],
  },
  {
    href: "/sdk-reference/coupons",
    title: "Coupons",
    description: "Create and manage discount codes, apply them to checkout sessions.",
    methods: [
      "createCoupon()",
      "listCoupons()",
      "archiveCoupon()",
      "applyCouponToCheckout()",
      "removeCouponFromCheckout()",
    ],
  },
  {
    href: "/sdk-reference/payment-links",
    title: "Payment Links",
    description: "Create reusable URLs that spawn a fresh checkout session on every visit.",
    methods: [
      "createPaymentLink()",
      "listPaymentLinks()",
      "getPaymentLink()",
      "updatePaymentLink()",
      "archivePaymentLink()",
    ],
  },
  {
    href: "/sdk-reference/blocklist",
    title: "Blocklist",
    description: "Block wallets, emails, or countries from paying through your checkouts.",
    methods: [
      "listBlocklist()",
      "addBlocklistEntry()",
      "removeBlocklistEntry()",
    ],
  },
];

export default function SdkReference() {
  return (
    <>
      <PageHeading
        title="SDK Reference"
        description={
          <>
            Complete API reference for{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
              @paylix/sdk
            </code>
            . Every method, parameter, and return type.
          </>
        }
      />

      <SectionHeading>Installation</SectionHeading>
      <CodeBlock language="bash">{`npm install @paylix/sdk`}</CodeBlock>

      <SectionHeading>Constructor</SectionHeading>
      <CodeBlock language="ts">{`new Paylix(config: PaylixConfig)`}</CodeBlock>

      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Parameter</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow
            name="apiKey"
            type="string"
            required
            description="Your secret API key (sk_live_... or sk_test_...)."
          />
          <ParamRow
            name="backendUrl"
            type="string"
            required
            description="URL of your Paylix backend instance."
          />
          <ParamRow
            name="network"
            type="PaylixNetwork"
            description={`Optional default network, used only for explorer/RPC metadata via the "network" accessor. It does NOT select the chain a checkout settles on — pass "networkKey" per call for that. One of: ethereum, base, arbitrum, optimism, polygon, bnb, avalanche, ethereum-sepolia, base-sepolia, arbitrum-sepolia, op-sepolia, polygon-amoy, bnb-testnet, avalanche-fuji, solana, solana-devnet, bitcoin, bitcoin-testnet, litecoin, litecoin-testnet.`}
          />
        </DocTableBody>
      </DocTable>

      <CodeBlock language="ts">{`import { Paylix } from "@paylix/sdk";

const paylix = new Paylix({
  apiKey: "sk_live_abc123",
  backendUrl: "https://paylix.example.com",
  network: "base", // optional, metadata only
});`}</CodeBlock>

      <SectionHeading>Methods</SectionHeading>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group rounded-lg border border-border bg-surface p-5 transition-colors hover:border-primary/40 hover:bg-surface-2"
          >
            <h3 className="text-sm font-semibold text-foreground group-hover:text-primary">
              {section.title}
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground-muted">
              {section.description}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {section.methods.map((m) => (
                <span
                  key={m}
                  className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-foreground-dim"
                >
                  {m}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      <SectionHeading>NETWORKS</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Exported constant containing network configurations.
      </p>
      <CodeBlock language="ts">{`import { NETWORKS } from "@paylix/sdk";

// NETWORKS = {
//   "base": {
//     chainId: 8453,
//     isEvm: true,
//     rpcUrl: "https://mainnet.base.org",
//     usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
//     explorerUrl: "https://basescan.org",
//   },
//   "base-sepolia": {
//     chainId: 84532,
//     isEvm: true,
//     rpcUrl: "https://sepolia.base.org",
//     usdcAddress: null,  // null on every testnet
//     explorerUrl: "https://sepolia.basescan.org",
//   },
//   "solana": {
//     chainId: 0,        // 0 on every non-EVM chain
//     isEvm: false,
//     rpcUrl: "https://api.mainnet-beta.solana.com",
//     usdcAddress: null,  // null on every non-EVM chain
//     explorerUrl: "https://solscan.io",
//   },
// }`}</CodeBlock>
    </>
  );
}
