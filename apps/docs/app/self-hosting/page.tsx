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

export const metadata: Metadata = { title: "Self-Hosting" };

export default function SelfHosting() {
  return (
    <>
      <PageHeading
        title="Self-Hosting"
        description="Paylix is fully open-source and designed to be self-hosted. Run your own instance with Docker Compose in under 10 minutes."
      />

      <Callout variant="info" title="What runs where">
        A Paylix deployment is three cooperating processes: the Next.js
        dashboard/API, a PostgreSQL database, and the indexer/keeper. The
        indexer must stay online — it is what watches the blockchain and
        charges subscriptions. If it goes down, payments stop settling in your
        dashboard.
      </Callout>

      <SectionHeading>Prerequisites</SectionHeading>
      <ul className="mt-4 space-y-2 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>Node.js 20 and pnpm 9.15.4 (<code>corepack enable pnpm</code>)</li>
        <li>Docker and Docker Compose installed</li>
        <li>A domain name (for HTTPS and webhooks)</li>
        <li>
          Two funded EOAs: a <strong className="text-foreground">relayer</strong>{" "}
          (pays gas for gasless checkout) and a{" "}
          <strong className="text-foreground">keeper</strong> (charges
          subscriptions)
        </li>
        <li>
          An RPC URL for each chain you accept (Alchemy, Infura, or a public
          RPC)
        </li>
        <li>
          Foundry, to deploy the contracts — on Windows it must run under WSL
        </li>
      </ul>

      <SectionHeading>1. Clone the Repository</SectionHeading>
      <CodeBlock language="bash">{`git clone https://github.com/JanoTheDev/paylix.git
cd paylix`}</CodeBlock>

      <SectionHeading>2. Configure Environment</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Copy the example environment file and fill in your values.
      </p>
      <CodeBlock language="bash">{`cp .env.example .env`}</CodeBlock>

      <SubsectionHeading>Required Environment Variables</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Variable</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">DATABASE_URL</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                PostgreSQL connection string. Use the Docker Compose default or
                your own database. On Windows use{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
                  127.0.0.1
                </code>{" "}
                rather than <code>localhost</code> — IPv6 resolution breaks
                Postgres auth.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">BETTER_AUTH_SECRET</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Random secret for authentication sessions. Generate with{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
                  openssl rand -base64 32
                </code>
                .
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">BETTER_AUTH_URL</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Public URL of your Paylix instance (e.g.{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
                  https://paylix.example.com
                </code>
                ).
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">NEXT_PUBLIC_NETWORK</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                The network the checkout bundle is built for, e.g.{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
                  base-sepolia
                </code>
                . Inlined at build time — changing it requires a rebuild.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">KEEPER_PRIVATE_KEY</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Private key for the keeper wallet that processes subscription
                charges. Fund with a small amount of native gas. The indexer
                refuses to boot without it.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">RELAYER_PRIVATE_KEY</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Private key for the relayer wallet that submits gasless
                payments. Must match the address passed to{" "}
                <code>setRelayer()</code> at deploy time.
              </span>
            </DocTableCell>
          </DocTableRow>
        </DocTableBody>
      </DocTable>

      <SubsectionHeading>Per-chain Variables</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Contract addresses and RPC URLs are namespaced per chain, not global.
        The prefix is the network key uppercased with hyphens replaced by
        underscores — <code>base-sepolia</code> becomes{" "}
        <code>BASE_SEPOLIA</code>. A group becomes active as soon as any one of
        its three variables is set, at which point all three are required.
      </p>
      <CodeBlock language="bash">{`# Fill in one group per chain you want to accept.
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
BASE_SEPOLIA_PAYMENT_VAULT=0x...
BASE_SEPOLIA_SUBSCRIPTION_MANAGER=0x...

# Testnets only — the MockUSDC the deploy script printed. The NEXT_PUBLIC_
# twin is what the checkout bundle reads.
BASE_SEPOLIA_MOCK_USDC_ADDRESS=0x...
NEXT_PUBLIC_MOCK_USDC_ADDRESS=0x...`}</CodeBlock>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The indexer runs a listener for every group it finds — one process
        covers all your chains.
      </p>

      <SectionHeading>3. Start with Docker Compose</SectionHeading>
      <CodeBlock language="bash">{`# Start all services
docker compose up -d

# This starts:
#   - PostgreSQL database
#   - Paylix web dashboard + API
#   - Blockchain indexer + keeper`}</CodeBlock>

      <SectionHeading>4. Run Database Migrations</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Run this from the host, not inside the container: the{" "}
        <code>web</code> image ships a standalone Next.js server, so pnpm and
        drizzle-kit are not in it. Docker Compose publishes Postgres on{" "}
        <code>:5432</code>, so the host command reaches the same database.
      </p>
      <CodeBlock language="bash">{`pnpm install
pnpm --filter @paylix/db db:push       # or db:migrate to apply the SQL migrations`}</CodeBlock>

      <SectionHeading>5. Access the Dashboard</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Open your browser and navigate to your configured URL. Create your
        first account, add a product, and generate API keys.
      </p>
      <CodeBlock language="bash">{`# Default local URL
http://localhost:3000`}</CodeBlock>

      <SectionHeading>6. Set Up a Reverse Proxy (Production)</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        For production, place Paylix behind a reverse proxy with TLS. Here is
        an example Caddy configuration:
      </p>
      <CodeBlock language="bash">{`paylix.example.com {
  reverse_proxy localhost:3000
}`}</CodeBlock>

      <SectionHeading>Gas Sponsorship (Gasless Payments)</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Paylix buyers don&apos;t need to hold ETH. At checkout the customer
        signs <strong className="text-foreground">two</strong> EIP-712
        messages off-chain (no transactions, no gas): an EIP-2612 permit that
        authorizes USDC spend, and a Paylix <code>PaymentIntent</code> that
        binds the exact merchant, amount, productId, and a per-buyer nonce.
        Your backend then submits the payment via a whitelisted{" "}
        <strong className="text-foreground">relayer wallet</strong> that pays
        gas on the buyer&apos;s behalf. USDC flows directly from buyer to
        merchant.
      </p>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The intent binding is what makes a stolen relayer key non-catastrophic:
        the contract verifies the buyer signed off on this exact merchant +
        amount, so a compromised relayer cannot redirect a signed permit to
        an attacker-controlled address. Subscriptions use the same pattern
        with a <code>SubscriptionIntent</code> that additionally binds the
        billing interval and the long-lived permit allowance.
      </p>
      <p className="text-sm leading-relaxed text-foreground-muted">
        You need to generate a dedicated relayer wallet and fund it with a
        small amount of ETH on your target chain.
      </p>

      <SubsectionHeading>1. Generate the relayer wallet</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Use Foundry&apos;s <code>cast wallet new</code> to create a fresh EOA.
        Do <strong className="text-foreground">not</strong> reuse your
        deployer key — keeping them separate lets you rotate the relayer
        without redeploying contracts.
      </p>
      <CodeBlock language="bash">{`cast wallet new`}</CodeBlock>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Copy both the Address and the Private Key from the output.
      </p>

      <SubsectionHeading>2. Configure the .env</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Add the relayer private key to your <code>paykit/.env</code>. The
        deploy script needs the matching <em>address</em> too — derive it from
        the key rather than copy-pasting it.
      </p>
      <CodeBlock language="bash">{`RELAYER_PRIVATE_KEY=0xYourRelayerPrivateKey
RELAYER_ADDRESS=0xDeriveWithCastWalletAddress`}</CodeBlock>

      <SubsectionHeading>3. Deploy and fund</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Deploy the contracts and pass the relayer address through as an env
        var — the Foundry script calls <code>setRelayer()</code> on both the
        PaymentVault and SubscriptionManager. Derive the address from your
        relayer private key with <code>cast wallet address</code>:
      </p>
      <CodeBlock language="bash">{`# From packages/contracts
set -a; . ../../.env; set +a
export RELAYER_ADDRESS=$(cast wallet address --private-key $RELAYER_PRIVATE_KEY)

# DeployTestnet also deploys a MockUSDC.
DEPLOYER_PRIVATE_KEY=$TESTNET_DEPLOYER_PRIVATE_KEY \\
PLATFORM_WALLET=$TESTNET_PLATFORM_WALLET \\
forge script script/DeployTestnet.s.sol \\
  --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast -vv`}</CodeBlock>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Mainnet uses <code>DeployMainnet.s.sol</code>, which additionally
        requires <code>USDC_ADDRESS</code> (the chain&apos;s canonical USDC)
        and <code>MULTISIG_OWNER</code>. Both are read with{" "}
        <code>vm.envAddress</code> and have no default — omit either and the
        script aborts before it broadcasts. <code>MULTISIG_OWNER</code> must
        also differ from the deployer EOA.
      </p>
      <CodeBlock language="bash">{`DEPLOYER_PRIVATE_KEY=$MAINNET_DEPLOYER_PRIVATE_KEY \\
PLATFORM_WALLET=$MAINNET_PLATFORM_WALLET \\
RELAYER_ADDRESS=$MAINNET_RELAYER_ADDRESS \\
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \\
MULTISIG_OWNER=0xYourSafeMultisigAddress \\
forge script script/DeployMainnet.s.sol \\
  --rpc-url $BASE_RPC_URL --broadcast -vv`}</CodeBlock>

      <Callout
        variant="warning"
        title="Mainnet: the deploy is not done when the script exits"
      >
        The contracts are <code>Ownable2Step</code>. The script calls{" "}
        <code>transferOwnership(MULTISIG_OWNER)</code>, which only makes the
        multisig the <strong className="text-foreground">pending</strong>{" "}
        owner. Until the multisig calls <code>acceptOwnership()</code> on{" "}
        <strong className="text-foreground">both</strong> contracts, the hot
        deployer EOA still owns them and can pause, re-fee, and rotate the
        relayer. Verify before moving the deployer key to cold storage:
      </Callout>
      <CodeBlock language="bash">{`# From the multisig — two separate transactions
acceptOwnership()   on <PAYMENT_VAULT_ADDRESS>
acceptOwnership()   on <SUBSCRIPTION_MANAGER_ADDRESS>

# Then confirm both return MULTISIG_OWNER, not the deployer
cast call <PAYMENT_VAULT_ADDRESS>        "owner()(address)" --rpc-url $BASE_RPC_URL
cast call <SUBSCRIPTION_MANAGER_ADDRESS> "owner()(address)" --rpc-url $BASE_RPC_URL`}</CodeBlock>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Copy the printed PaymentVault and SubscriptionManager addresses into
        your <code>.env</code> (both the server-side and{" "}
        <code>NEXT_PUBLIC_*</code> copies). Then fund the relayer wallet with
        ETH on the target chain. A small balance goes a long way —
        ~0.005 ETH on Base Sepolia covers around 1,000 relayed transactions.
      </p>

      <SubsectionHeading>4. Monitor balance</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The dashboard sidebar shows a live relayer balance indicator. You can
        also hit the status endpoint directly:
      </p>
      <CodeBlock language="bash">{`curl http://localhost:3000/api/system/relayer-status`}</CodeBlock>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Returns <code>{`{ configured, address, balanceWei, balanceEth, low }`}</code>.
        The sidebar will switch from green to amber and show &quot;(low)&quot;
        when the balance drops below 0.001 ETH.
      </p>

      <SubsectionHeading>5. Rotating the relayer key</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        If the relayer private key leaks or you want to rotate it defensively,
        you can swap it without redeploying contracts. Downtime is about 10
        seconds — just long enough to run a <code>setRelayer</code> call and
        restart the web server.
      </p>
      <CodeBlock language="bash">{`# 1. Generate a new wallet
cast wallet new

# 2. Copy the new address; call setRelayer on both contracts
cast send <PAYMENT_VAULT_ADDRESS> 'setRelayer(address)' <NEW_ADDRESS> \\
  --rpc-url $BASE_SEPOLIA_RPC_URL --private-key $TESTNET_DEPLOYER_PRIVATE_KEY

cast send <SUBSCRIPTION_MANAGER_ADDRESS> 'setRelayer(address)' <NEW_ADDRESS> \\
  --rpc-url $BASE_SEPOLIA_RPC_URL --private-key $TESTNET_DEPLOYER_PRIVATE_KEY

# 3. Update paykit/.env with the new private key
# RELAYER_PRIVATE_KEY=0xNEW_PRIVATE_KEY

# 4. Fund the new relayer wallet with ETH
cast send <NEW_ADDRESS> --value 0.01ether \\
  --rpc-url $BASE_SEPOLIA_RPC_URL --private-key $TESTNET_DEPLOYER_PRIVATE_KEY

# 5. Restart the web server so it picks up the new key
pnpm --filter @paylix/web dev`}</CodeBlock>

      <SubsectionHeading>6. Emergency pause</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        If gasless payments start misbehaving in production — a bug in the
        relay path, an exploit attempt, or a runaway cost — you can freeze
        them without affecting direct wallet payments (buyers who hold ETH
        and pay gas themselves can still check out).
      </p>
      <CodeBlock language="bash">{`# Pause gasless on both contracts
cast send <PAYMENT_VAULT_ADDRESS> 'setGaslessPaused(bool)' true \\
  --rpc-url $BASE_SEPOLIA_RPC_URL --private-key $TESTNET_DEPLOYER_PRIVATE_KEY

cast send <SUBSCRIPTION_MANAGER_ADDRESS> 'setGaslessPaused(bool)' true \\
  --rpc-url $BASE_SEPOLIA_RPC_URL --private-key $TESTNET_DEPLOYER_PRIVATE_KEY

# To unpause, pass false instead of true.`}</CodeBlock>

      <Callout variant="warning" title="Pause doesn't cancel existing subscriptions">
        Paused gasless means no new payments and no new subscriptions can go
        through the relayer. Existing subscriptions that were already created
        continue charging normally via the keeper (which doesn&apos;t go
        through the relayer path). Cancellation via the relayer is also
        blocked while paused — document this for your operators so they know
        the direct <code>cancelSubscription</code> from their own wallet is
        the escape hatch.
      </Callout>

      <SubsectionHeading>7. Mainnet readiness check</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Before your first mainnet deploy, run the Foundry mainnet fork test
        against real Circle USDC to verify that the gasless permit flow works
        with the real token&apos;s EIP-712 domain. This catches issues with
        domain version, nonces, or signature recovery that MockUSDC wouldn&apos;t.
      </p>
      <CodeBlock language="bash">{`FORK_RPC_URL=https://mainnet.base.org \\
  ~/.foundry/bin/forge test --match-path "test/mainnet-fork/*" \\
  --fork-url $FORK_RPC_URL -vvv`}</CodeBlock>

      <SectionHeading>Indexer Confirmations</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The indexer never marks a payment confirmed from the unsafe head. By
        default it waits for <code>5</code> block confirmations on Base
        (~10 seconds) before processing an event — long enough that a
        sequencer hiccup can&apos;t reorg out a payment, short enough for
        Stripe-like UX. Tune via env in <code>paykit/.env</code>:
      </p>
      <CodeBlock language="bash">{`# Default. ~10s lag on Base, effectively zero reorg risk.
INDEXER_CONFIRMATIONS=5

# Lower for snappier devnet feel (no reorg protection — devnet only).
# INDEXER_CONFIRMATIONS=0

# Or use an explicit block tag if you want L1 finality semantics.
# INDEXER_BLOCK_TAG=safe       # ~6 minute lag
# INDEXER_BLOCK_TAG=finalized  # ~12 minute lag (cryptographic finality)`}</CodeBlock>
      <p className="text-sm leading-relaxed text-foreground-muted">
        When <code>INDEXER_BLOCK_TAG</code> is set it takes precedence over
        <code> INDEXER_CONFIRMATIONS</code>. Restart the indexer after
        changing either value.
      </p>

      <SectionHeading>Optional Environment Variables</SectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Variable</DocTableHeader>
            <DocTableHeader>Required</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">REDIS_URL</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">No</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Redis connection URL for distributed rate limiting. If unset,
                in-memory rate limiting is used (single instance only).
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">
                BASE_SEPOLIA_MOCK_USDC_ADDRESS /
                NEXT_PUBLIC_MOCK_USDC_ADDRESS
              </span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">Testnet only</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Address of the MockUSDC contract the testnet deploy script
                printed. Each testnet has its own pair — see{" "}
                <code>packages/config/src/networks/</code>.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">INVOICE_FROM_EMAIL</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">No</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Sender email address for invoice and notification emails.
                Default:{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
                  invoices@paylix.local
                </code>
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">PUBLIC_APP_URL</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">No</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Public URL of the dashboard. Used in email links and portal
                URLs. Default:{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
                  http://localhost:3000
                </code>
              </span>
            </DocTableCell>
          </DocTableRow>
        </DocTableBody>
      </DocTable>

      <SectionHeading>Updating</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The default branch is <code>master</code>. Run the migration from the
        host for the same reason as step 4 — the <code>web</code> container has
        no pnpm workspace and no drizzle-kit.
      </p>
      <CodeBlock language="bash">{`git pull origin master
docker compose down
docker compose up -d --build

# From the host, against the Postgres published on :5432
pnpm install
pnpm --filter @paylix/db db:push`}</CodeBlock>
    </>
  );
}
