import type { Metadata } from "next";
import {
  Callout,
  DocTable,
  DocTableBody,
  DocTableCell,
  DocTableHead,
  DocTableHeader,
  DocTableRow,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Supported Chains & Tokens" };

interface Row {
  chain: string;
  testnet: string;
  tokens: string;
  notes?: string;
}

const evmRows: Row[] = [
  { chain: "Ethereum", testnet: "Sepolia", tokens: "USDC, USDT, DAI*, WETH, WBTC, PYUSD" },
  { chain: "Base", testnet: "Base Sepolia", tokens: "USDC, DAI, WETH" },
  { chain: "Arbitrum One", testnet: "Arbitrum Sepolia", tokens: "USDC, USDT, DAI, WETH, WBTC" },
  { chain: "Optimism", testnet: "OP Sepolia", tokens: "USDC, USDT, DAI, WETH, WBTC" },
  { chain: "Polygon PoS", testnet: "Polygon Amoy", tokens: "USDC, USDT, DAI, WETH†, WBTC" },
  { chain: "BNB Chain", testnet: "BNB Testnet", tokens: "USDC†‡, USDT†, DAI†, WETH†" },
  { chain: "Avalanche C-Chain", testnet: "Avalanche Fuji", tokens: "USDC, USDT, DAI†, WETH†, WBTC" },
];

const nonEvmRows: Row[] = [
  { chain: "Solana", testnet: "Devnet", tokens: "USDC, USDT, PYUSD", notes: "Anchor programs + indexer scaffolded; operator deploys" },
  { chain: "Bitcoin", testnet: "Testnet", tokens: "BTC", notes: "One-time only (no on-chain auth for subs)" },
  { chain: "Litecoin", testnet: "Testnet", tokens: "LTC", notes: "One-time only" },
];

export default function SupportedChains() {
  return (
    <>
      <PageHeading
        title="Supported Chains & Tokens"
        description="Paylix runs across every major EVM chain plus scaffolded Solana, Bitcoin, and Litecoin. Merchants configure which combinations to accept; the hosted checkout routes automatically."
      />

      <Callout variant="tip" title="Adding a chain is a config change">
        New chains land by extending{" "}
        <code className="font-mono text-[13px]">packages/config/src/networks/</code>
        {" "}plus running{" "}
        <code className="font-mono text-[13px]">
          forge script script/DeployMainnet.s.sol
        </code>{" "}
        against that chain&apos;s RPC and filling in the matching{" "}
        <code className="font-mono text-[13px]">
          ${"{"}CHAIN_KEY{"}"}_*
        </code>{" "}
        env group. No business-logic edits required.
      </Callout>

      <SectionHeading>EVM Chains</SectionHeading>
      <DocTable>
        <DocTableHeader>
          <DocTableRow>
            <DocTableHead>Mainnet</DocTableHead>
            <DocTableHead>Testnet</DocTableHead>
            <DocTableHead>Tokens</DocTableHead>
          </DocTableRow>
        </DocTableHeader>
        <DocTableBody>
          {evmRows.map((r) => (
            <DocTableRow key={r.chain}>
              <DocTableCell>{r.chain}</DocTableCell>
              <DocTableCell>{r.testnet}</DocTableCell>
              <DocTableCell>{r.tokens}</DocTableCell>
            </DocTableRow>
          ))}
        </DocTableBody>
      </DocTable>

      <p className="text-[12px] text-foreground-muted">
        * Ethereum DAI uses the legacy DAI-permit interface (one-time only).{" "}
        † Bridged token (not the issuer&apos;s canonical deployment).{" "}
        ‡ BNB bridged USDC is 18-decimal with no gasless path — listed but
        inert until a future Permit2-compatible deployment.
      </p>

      <SectionHeading>Non-EVM Chains</SectionHeading>
      <DocTable>
        <DocTableHeader>
          <DocTableRow>
            <DocTableHead>Mainnet</DocTableHead>
            <DocTableHead>Testnet</DocTableHead>
            <DocTableHead>Tokens</DocTableHead>
            <DocTableHead>Notes</DocTableHead>
          </DocTableRow>
        </DocTableHeader>
        <DocTableBody>
          {nonEvmRows.map((r) => (
            <DocTableRow key={r.chain}>
              <DocTableCell>{r.chain}</DocTableCell>
              <DocTableCell>{r.testnet}</DocTableCell>
              <DocTableCell>{r.tokens}</DocTableCell>
              <DocTableCell>{r.notes ?? "—"}</DocTableCell>
            </DocTableRow>
          ))}
        </DocTableBody>
      </DocTable>

      <SectionHeading>Signing schemes</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Every token carries a signature scheme that tells the hosted checkout
        which gasless flow to use. Merchants don&apos;t need to think about
        this — the SDK and dashboard handle it. Relevant when reading source
        or debugging a failed payment:
      </p>
      <DocTable>
        <DocTableHeader>
          <DocTableRow>
            <DocTableHead>Scheme</DocTableHead>
            <DocTableHead>Used for</DocTableHead>
            <DocTableHead>One-time</DocTableHead>
            <DocTableHead>Subscriptions</DocTableHead>
          </DocTableRow>
        </DocTableHeader>
        <DocTableBody>
          <DocTableRow>
            <DocTableCell>EIP-2612</DocTableCell>
            <DocTableCell>USDC, PYUSD</DocTableCell>
            <DocTableCell>✅</DocTableCell>
            <DocTableCell>✅</DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell>Permit2</DocTableCell>
            <DocTableCell>USDT, WETH, WBTC, bridged DAI</DocTableCell>
            <DocTableCell>✅</DocTableCell>
            <DocTableCell>✅</DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell>DAI-permit</DocTableCell>
            <DocTableCell>Ethereum-mainnet DAI</DocTableCell>
            <DocTableCell>✅</DocTableCell>
            <DocTableCell>—</DocTableCell>
          </DocTableRow>
        </DocTableBody>
      </DocTable>
    </>
  );
}
