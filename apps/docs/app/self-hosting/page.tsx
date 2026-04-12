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
        <li>Docker and Docker Compose installed</li>
        <li>A domain name (for HTTPS and webhooks)</li>
        <li>
          An Ethereum wallet with a private key (for the indexer/keeper to
          process subscription charges)
        </li>
        <li>A Base RPC URL (Alchemy, Infura, or public RPC)</li>
      </ul>

      <SectionHeading>1. Clone the Repository</SectionHeading>
      <CodeBlock language="bash">{`git clone https://github.com/paylix/paylix.git
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
                your own database.
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
                  openssl rand -hex 32
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
              <span className="text-foreground">RPC_URL</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Base mainnet RPC URL (e.g. from Alchemy or Infura).
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
                charges. Fund with a small amount of ETH for gas.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">PAYMENT_CONTRACT_ADDRESS</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Address of the deployed Paylix payment contract.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">
                SUBSCRIPTION_CONTRACT_ADDRESS
              </span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Address of the deployed Paylix subscription contract.
              </span>
            </DocTableCell>
          </DocTableRow>
        </DocTableBody>
      </DocTable>

      <SectionHeading>3. Start with Docker Compose</SectionHeading>
      <CodeBlock language="bash">{`# Start all services
docker compose up -d

# This starts:
#   - PostgreSQL database
#   - Paylix web dashboard + API
#   - Blockchain indexer + keeper`}</CodeBlock>

      <SectionHeading>4. Run Database Migrations</SectionHeading>
      <CodeBlock language="bash">{`# Push schema to database
docker compose exec web pnpm --filter @paylix/db db:push`}</CodeBlock>

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
        Add the relayer private key to your{" "}
        <code>paykit/.env</code>. <code>RELAYER_ADDRESS</code> is derived
        automatically by the deploy script — leave it blank.
      </p>
      <CodeBlock language="bash">{`RELAYER_PRIVATE_KEY=0xYourRelayerPrivateKey
RELAYER_ADDRESS=`}</CodeBlock>

      <SubsectionHeading>3. Deploy and fund</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Deploy the contracts and pass the relayer address through as an env
        var — the deploy script will call <code>setRelayer()</code> on both
        the PaymentVault and SubscriptionManager. Derive the address from
        your relayer private key with{" "}
        <code>cast wallet address</code>:
      </p>
      <CodeBlock language="bash">{`# From packages/contracts
export RELAYER_ADDRESS=$(cast wallet address --private-key $RELAYER_PRIVATE_KEY)

forge script script/DeployTestnet.s.sol \\
  --rpc-url $RPC_URL --broadcast -v`}</CodeBlock>
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
  --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY

cast send <SUBSCRIPTION_MANAGER_ADDRESS> 'setRelayer(address)' <NEW_ADDRESS> \\
  --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY

# 3. Update paykit/.env with the new private key
# RELAYER_PRIVATE_KEY=0xNEW_PRIVATE_KEY

# 4. Fund the new relayer wallet with ETH
cast send <NEW_ADDRESS> --value 0.01ether \\
  --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY

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
  --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY

cast send <SUBSCRIPTION_MANAGER_ADDRESS> 'setGaslessPaused(bool)' true \\
  --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY

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
                MOCK_USDC_ADDRESS / NEXT_PUBLIC_MOCK_USDC_ADDRESS
              </span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">Testnet only</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Address of the MockUSDC contract on Base Sepolia.
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
      <CodeBlock language="bash">{`git pull origin main
docker compose down
docker compose up -d --build
docker compose exec web pnpm --filter @paylix/db db:push`}</CodeBlock>
    </>
  );
}
