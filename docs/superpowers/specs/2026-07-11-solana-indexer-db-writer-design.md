# Solana indexer: Postgres writer

## Problem

Issue #65 ("Postgres bindings for Solana + UTXO indexers") is closed, but only
the UTXO side actually got a Drizzle-backed writer
(`packages/utxo-indexer/src/db-callbacks.ts`). The Solana side does not:

- `packages/solana-indexer/src/index.ts:45-49` — the listener's `onEvent`
  handler only `console.log`s the decoded event, with a comment pointing at
  a "#57 follow-up PR" that was never opened as its own issue.
- `packages/solana-indexer/src/writer.ts` defines a `WriterCallbacks`
  interface and a `makeEventHandler()` dispatcher, but nothing in the repo
  implements `WriterCallbacks` or calls `makeEventHandler`.
- The keeper (`packages/solana-indexer/src/keeper.ts`) runs in explicit
  "skeleton mode" because it depends on the same missing DB bindings for its
  due-subscription query.

Net effect: Solana payments and subscriptions are decoded off-chain but never
reach Postgres. Nothing shows up in the dashboard, no session ever completes,
no subscription ever exists to charge. This is a correctness gap, and it's
also a credibility gap — the closed issue implies this already works.

## Goal

Wire a real Postgres writer for the Solana listener, so Solana payment and
subscription *events* are correctly persisted. Match the depth already
shipped for UTXO (`packages/utxo-indexer/src/db-callbacks.ts`): payment rows,
subscription rows, checkout-session status transitions, and unmatched-event
retention. No webhooks, invoices, or emails in this pass — those are real
gaps too, but they're a separate, larger unit of work with their own review
surface.

## Non-goals (explicit)

- **Keeper wiring.** `startKeeper`'s `dueSubscriptions()` query and keypair
  loading move real subscriber money on interval — separate follow-up with
  its own testing (idempotency, partial-tx-failure handling). This pass only
  touches the listener path (recording events), which is read-only with
  respect to the chain.
- **Webhooks / invoices / emails for Solana payments.** Full EVM parity
  (`packages/indexer/src/handlers.ts`) is ~300 lines per handler including
  customer upsert, invoice generation, webhook dispatch, and audit logging.
  UTXO shipped without any of this. Solana matches that bar first.
- **Active replay of unmatched Solana events.** EVM's
  `retryUnmatchedEvents` (`packages/indexer/src/handlers.ts:1423`) is
  EVM-shaped — it rehydrates `viem` `Log` objects and calls EVM handler
  functions. This pass satisfies the CLAUDE.md invariant ("unmatched events
  are retained, not dropped") by writing to the existing `unmatched_events`
  table. A Solana-shaped retry loop is a natural next step but is not
  required to close the credibility gap — retention alone means no event is
  silently lost.
- **`@paylix/config` changes.** `NETWORKS` / `getToken` are EVM-only by
  design — `packages/config/src/__tests__/networks.test.ts:326-328,453,492`
  explicitly assert that `"solana"` is an *invalid* `NetworkKey`. Token
  symbol/decimals resolution for Solana stays local to `solana-indexer`.

## Design

### New file: `packages/solana-indexer/src/token-registry.ts`

A small static map, not a registry system — three tokens, two clusters:

```ts
export interface SolanaTokenInfo {
  symbol: string;
  decimals: number;
}

const MAINNET_MINTS: Record<string, SolanaTokenInfo> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": { symbol: "PYUSD", decimals: 6 },
};
// devnet mint map: separate table, populated from the deployed devnet mints
// used by DeployTestnet-equivalent tooling for Solana.

export function resolveMint(networkKey: "solana" | "solana-devnet", mint: string): SolanaTokenInfo;
```

Throws on an unrecognized mint, same posture as EVM's `symbolForTokenAddress`
(`packages/indexer/src/handlers.ts:69-84`) — an unknown mint means either a
misconfigured deploy or an attempted payment in an unsupported token, and
silently guessing decimals would corrupt the cents conversion.

### New file: `packages/solana-indexer/src/db-callbacks.ts`

```ts
export interface SolanaDbCallbacksOptions {
  db: Database; // @paylix/db/client
  networkKey: "solana" | "solana-devnet";
}

export function makeSolanaDbCallbacks(opts: SolanaDbCallbacksOptions): WriterCallbacks
```

Implements the four `WriterCallbacks` methods from `writer.ts`. Structure
mirrors `utxo-indexer/src/db-callbacks.ts` throughout: same
try/catch-on-duplicate-insert pattern, same "log and move on" posture for
recoverable races, same dependency-injected `db` so tests can pass a fake.

**`recordPayment(ev)`**
1. Idempotency: the `payments_chain_tx_idx` unique index on
   `(chain, txHash)` already covers this — attempt the insert, catch the
   unique-violation, log and return (same as UTXO's `onPayment`).
2. Match: query `checkoutSessions` where `networkKey = opts.networkKey`,
   `status in ('active','viewed')`, ordered by `createdAt desc`, limit 200.
   Filter client-side for the row whose `keccak256(stringToBytes(id))`
   equals `ev.productId`... no — equals `ev.customerId` (the checkout client
   encodes `customerId = keccak256(session.id)`,
   `apps/web/app/checkout/[sessionId]/solana-pay.tsx:64-103` — same
   convention as EVM's `handlePaymentReceived`,
   `packages/indexer/src/handlers.ts:162-184`).
3. No match → insert into `unmatchedEvents`
   (`eventType: "SolanaPaymentReceived"`, `txHash: ev.signature`,
   `blockNumber: ev.slot`, `payload: serialized ev`, `livemode` derived from
   `opts.networkKey !== "solana-devnet"`). Return.
4. Match found → resolve token via `resolveMint`. **`resolveMint` is called
   inside the same try/catch as the unmatched-event fallback path**: an
   unrecognized mint routes to `unmatchedEvents` (`eventType:
   "SolanaPaymentReceivedUnknownMint"`) rather than throwing past
   `db-callbacks.ts` — the CLAUDE.md retention invariant applies to *any*
   reason a payment can't be written, not only a session-matching miss.
   Otherwise convert `ev.amount`/`ev.fee` to cents, insert `payments` row
   (`chain: opts.networkKey`, `token: symbol`, `txHash: ev.signature`,
   `blockNumber: ev.slot`, `fromAddress: ev.buyer`, `toAddress: ev.merchant`,
   `customerId: session.customerId`, `livemode: session.livemode`) — skip
   the insert (but still flip session status) if `session.customerId` is
   null, identical to UTXO's documented tradeoff
   (`utxo-indexer/src/db-callbacks.ts:100-106`). Update session to
   `status: "completed"`, `completedAt: now()`.

**`recordSubscriptionCreated(ev)`** — same match-by-hash against sessions
with `type = 'subscription'`. On match, insert a `subscriptions` row:
`contractAddress: ev.programId`, `onChainId: ev.subscriptionId.toString()`,
`subscriberAddress: ev.subscriber`, `networkKey: opts.networkKey`,
`tokenSymbol` via `resolveMint`, `intervalSeconds: Number(ev.intervalSeconds)`,
`status: "active"`, `currentPeriodStart: now()`,
`nextChargeDate: now() + intervalSeconds`. Flip the checkout session to
`completed` and link `subscriptionId`. No match → `unmatchedEvents`, same as
payments.

**`recordSubscriptionCharged(ev)`** — look up `subscriptions` by
`(contractAddress = ev.programId, onChainId = ev.subscriptionId.toString())`.
No match → `unmatchedEvents`. Match → idempotent payment insert (same
duplicate-catch as `recordPayment`) linked via `lastPaymentId`, and update
`currentPeriodStart/End`, `nextChargeDate += intervalSeconds`,
`pastDueSince: null`, `chargeFailureCount: 0`.

**`recordSubscriptionCancelled(ev)`** — look up the same way, set
`status: "cancelled"`. No match → `unmatchedEvents`.

### Changed file: `packages/solana-indexer/src/index.ts`

- Add `requireEnv("SOLANA_NETWORK_KEY")`, validated to `"solana" |
  "solana-devnet"` — the decoded event carries a `programId` but no cluster
  identifier, so the process needs to know which network it's serving (same
  role as UTXO's `networkKey` passed into `makeUtxoDbCallbacks`).
- Construct `const db = createDb(requireEnv("DATABASE_URL"))` and
  `const callbacks = makeSolanaDbCallbacks({ db, networkKey })`.
- Replace the `console.log`-only `onEvent` with
  `makeEventHandler(callbacks)`, keeping a log line before dispatch for
  operational visibility.
- Keeper construction is unchanged — still starts in skeleton mode, per the
  non-goals above. Remove the comment claiming DB bindings are the blocker
  for the keeper's *listener*-side dependency, since that part is now
  wired; keep the comment accurate about the keeper itself still needing its
  own follow-up.

### Schema

No migration needed. `payments`, `subscriptions`, `checkoutSessions`, and
`unmatchedEvents` are already chain-agnostic (`networkKey`/`chain` are
`text`, not an enum pinned to EVM chains) — this is exactly the same reason
UTXO didn't need new payment/subscription columns either.

## Testing

`packages/solana-indexer/src/__tests__/db-callbacks.test.ts`, following the
dependency-injection seam `makeSolanaDbCallbacks({ db, networkKey })` already
provides (mirrors how `makeUtxoDbCallbacks` documents itself as testable via
"an in-memory fake"). Cases:

- Payment matches an active session → row inserted, session completed.
- Payment matches no session → row appears in `unmatchedEvents`, no throw.
- Duplicate payment (same `chain`+`txHash`) → second call is a no-op, not a
  crash.
- Session with null `customerId` → session still completes, no payment row
  (matches UTXO's documented tradeoff).
- Subscription created → row inserted with correct `nextChargeDate`.
- Subscription charged for unknown `(contractAddress, onChainId)` →
  `unmatchedEvents`, not a throw.
- Subscription cancelled → status flips, idempotent on re-delivery.
- `resolveMint` throws on an unrecognized mint address.

## Risks

- **Silent mismatch between `SOLANA_NETWORK_KEY` and the actual
  `SOLANA_RPC_URL` cluster** (e.g. process configured with
  `SOLANA_NETWORK_KEY=solana` but pointed at a devnet RPC) would tag
  mainnet payments as devnet or vice versa, with `livemode` computed wrong
  as a result. Mitigate by logging the resolved network key loudly at
  startup; a stronger check (matching `getGenesisHash()` against known
  cluster genesis hashes) is a reasonable hardening follow-up, not required
  to close this gap.
- **Mint registry drift** — if a new SPL token is enabled on-chain before
  `token-registry.ts` is updated, `resolveMint` fails but the event is still
  retained in `unmatchedEvents` (see recordPayment step 4 above) rather than
  dropped. `listener.ts:50-58` also wraps every `onEvent` call in try/catch
  as a second layer, so even an unanticipated exception in `db-callbacks.ts`
  can't kill the listener loop — confirmed by reading the existing code, not
  assumed.
