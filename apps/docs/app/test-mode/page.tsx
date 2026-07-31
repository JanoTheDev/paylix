import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  DocTable,
  DocTableBody,
  DocTableCell,
  DocTableHead,
  DocTableHeader,
  DocTableRow,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Test Mode" };

export default function TestMode() {
  return (
    <>
      <PageHeading
        title="Test Mode"
        description="Build and validate your Paylix integration without touching real money. Test mode runs on Base Sepolia with MockUSDC — live mode runs on Base mainnet with real USDC."
      />

      <Callout variant="tip" title="Isolated by design">
        Test and live data never mix. Every payment, customer, product, and
        subscription row carries a{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          livemode
        </code>{" "}
        flag, and the dashboard filters by the mode you currently have selected.
        Flipping between modes is a view toggle — nothing running in live mode
        is paused or affected.
      </Callout>

      <SectionHeading>Switching modes</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Use the mode toggle in the left sidebar of the dashboard. New merchant
        accounts default to test mode so you can build without risk.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        Every dashboard page — Products, Customers, Payments, Subscriptions,
        Audit Logs — shows data for the currently selected mode only. A yellow
        <strong className="text-foreground"> Test Mode</strong> banner runs
        across the top of every page when test mode is active so you always know
        which environment you are looking at.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        Switching to live mode while live payments are running has no effect on
        those payments — it just changes what the dashboard displays.
      </p>

      <SectionHeading>Test and live API keys</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        API keys encode both their type (publishable vs. secret) and their mode
        in the prefix:
      </p>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Prefix</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Mode</DocTableHeader>
            <DocTableHeader>Rate limit</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <DocTableRow>
            <DocTableCell mono>pk_test_</DocTableCell>
            <DocTableCell>Publishable</DocTableCell>
            <DocTableCell>Test</DocTableCell>
            <DocTableCell>500 req / min</DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>sk_test_</DocTableCell>
            <DocTableCell>Secret</DocTableCell>
            <DocTableCell>Test</DocTableCell>
            <DocTableCell>250 req / min</DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>pk_live_</DocTableCell>
            <DocTableCell>Publishable</DocTableCell>
            <DocTableCell>Live</DocTableCell>
            <DocTableCell>200 req / min</DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>sk_live_</DocTableCell>
            <DocTableCell>Secret</DocTableCell>
            <DocTableCell>Live</DocTableCell>
            <DocTableCell>100 req / min</DocTableCell>
          </DocTableRow>
        </DocTableBody>
      </DocTable>
      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        Generate keys under{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          Settings → API Keys → New key
        </code>
        . The mode of the key is derived from the dashboard mode you have
        selected when you create it — switch to live mode first if you want a
        live key.
      </p>
      <CodeBlock language="ts">{`import { Paylix } from "@paylix/sdk";

// Test mode — uses Base Sepolia + MockUSDC
const paylix = new Paylix({
  apiKey: "sk_test_...",
  backendUrl: "https://pay.example.com",
});

// Live mode — uses Base mainnet + real USDC
const livePaylix = new Paylix({
  apiKey: "sk_live_...",
  backendUrl: "https://pay.example.com",
});`}</CodeBlock>

      <SectionHeading>The faucet</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Test-mode wallets need MockUSDC to complete a checkout. Paylix provides
        a faucet that mints up to 1000 MockUSDC per wallet per 24 hours. There
        are three ways to use it:
      </p>

      <SubsectionHeading>1. From the checkout page</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        When a buyer hits a test-mode checkout with insufficient MockUSDC
        balance, a yellow{" "}
        <strong className="text-foreground">Fund test wallet</strong> button
        appears inline. One click mints 1000 MockUSDC directly to the connected
        wallet — no separate tab or contract call needed.
      </p>

      <SubsectionHeading>2. From the SDK</SubsectionHeading>
      <CodeBlock language="ts">{`// Mint MockUSDC to any wallet programmatically
await paylix.testFaucet({ address: "0x..." });`}</CodeBlock>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Calling{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          testFaucet
        </code>{" "}
        on a live-mode key throws immediately — it is only callable with a{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          sk_test_
        </code>{" "}
        key.
      </p>

      <SubsectionHeading>3. Manual mint via Foundry</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        If the faucet is rate-limited or you need a custom amount, call
        MockUSDC directly. The deployer key has minter rights.
      </p>
      <CodeBlock language="bash">{`cast send $BASE_SEPOLIA_MOCK_USDC \\
  "mint(address,uint256)" \\
  <YOUR_WALLET> 1000000000 \\
  --rpc-url https://sepolia.base.org \\
  --private-key <DEPLOYER_KEY>
# 1000000000 = 1000 USDC (6 decimals)`}</CodeBlock>

      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        Faucet rate limits:
      </p>
      <ul className="mt-2 space-y-1 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>1 successful mint per wallet per 24 hours</li>
        <li>Maximum 1000 MockUSDC per mint request</li>
        <li>10 faucet calls per minute per API key</li>
        <li>100 000 MockUSDC global cap per 24 hours across all merchants</li>
      </ul>

      <SectionHeading>Webhook <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">livemode</code> field</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Every webhook event envelope includes a top-level{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          livemode: boolean
        </code>{" "}
        field. Branch on it to avoid running production-critical code — sending
        emails, charging external systems, updating a ledger — in response to
        test events.
      </p>
      <CodeBlock language="ts">{`app.post("/webhook", async (req, res) => {
  const webhook = req.body;

  if (!webhook.livemode) {
    // Test-mode event — log it but skip side-effects
    console.log(\`[TEST] \${webhook.event} for \${webhook.data.id}\`);
    return res.status(200).send();
  }

  // Real event — run the normal handler
  await handleLiveEvent(webhook);
  res.status(200).send();
});`}</CodeBlock>
      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        The HMAC signature covers the entire body including{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          livemode
        </code>
        , so signature verification catches any attempt to tamper with the
        field. See{" "}
        <a href="/webhook-verification" className="text-primary hover:underline">
          Webhook Verification
        </a>{" "}
        for the full verification guide.
      </p>

      <SectionHeading>Going live</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        When your integration is working end-to-end in test mode, follow this
        checklist to flip to production:
      </p>
      <ol className="mt-4 space-y-3 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-decimal">
        <li>
          <strong className="text-foreground">Deploy contracts to Base mainnet.</strong>{" "}
          Run the existing Foundry deploy script pointed at a mainnet RPC URL.
        </li>
        <li>
          <strong className="text-foreground">Add the mainnet env vars</strong>{" "}
          to your{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            .env
          </code>
          :{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            BASE_RPC_URL
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            BASE_PAYMENT_VAULT
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            BASE_SUBSCRIPTION_MANAGER
          </code>
          .
        </li>
        <li>
          <strong className="text-foreground">Fund the keeper and relayer wallets</strong>{" "}
          with real ETH on Base mainnet. Around 0.05 ETH each is a comfortable
          starting float.
        </li>
        <li>
          <strong className="text-foreground">Restart the web server and indexer.</strong>{" "}
          They auto-discover both the testnet and mainnet deployments on startup.
        </li>
        <li>
          <strong className="text-foreground">Generate live API keys</strong>{" "}
          in the dashboard by switching to live mode first, then going to{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            Settings → API Keys → New key
          </code>
          .
        </li>
        <li>
          <strong className="text-foreground">Make a small live payment first.</strong>{" "}
          Create a $1 product, pay from your own wallet, and confirm it appears
          in the dashboard and that the webhook fires with{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            livemode: true
          </code>
          .
        </li>
        <li>
          <strong className="text-foreground">Swap your production keys over</strong>{" "}
          in your app&apos;s{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            .env
          </code>{" "}
          and redeploy.
        </li>
      </ol>

      <Callout variant="info" title="Both modes run simultaneously">
        A single Paylix deployment serves test and live traffic at the same
        time. You do not need two separate instances. The indexer and web server
        watch both the Base Sepolia and Base mainnet contracts concurrently, and
        the dashboard mode toggle is just a filter on top of the same database.
      </Callout>
    </>
  );
}
