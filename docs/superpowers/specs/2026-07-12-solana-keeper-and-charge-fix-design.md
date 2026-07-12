# Solana subscription keeper + charge_subscription account-validation fix

## Problem

The Solana indexer's keeper (`packages/solana-indexer/src/keeper.ts`) has always
run in "skeleton mode" — `startKeeper()` boots but never actually charges a
subscription, because it has no keeper keypair and no source of due
subscriptions. This was explicitly deferred in the prior spec
(`2026-07-11-solana-indexer-db-writer-design.md`) so the listener/writer path
could ship first. This spec closes that gap.

While scoping the keeper, a real security gap surfaced in the on-chain
program it will call. `charge_subscription`
(`packages/solana-program/programs/paylix_subscription_manager/src/lib.rs:118-164`)
accepts caller-supplied `merchant_ata` and `platform_ata` accounts with no
on-chain check that they match the subscription's actual merchant or the
configured platform wallet. `create_subscription` and `create_payment` don't
have this problem — the buyer signs those transactions directly, so the
buyer's own signature binds the exact accounts listed. `charge_subscription`
is the only instruction submitted without the buyer present (only the
keeper, or the subscriber calling it themselves per
`require!(caller == cfg.keeper || caller == sub.subscriber, ...)`), which is
exactly why it needs an on-chain backstop instead of relying on caller
correctness alone. Building a keeper on top of the unfixed contract would
make "the keeper's TypeScript is bug-free forever" the only thing standing
between a subscriber's recurring payment and an arbitrary token account —
worse than the EVM path, where `_consumeSubscriptionIntent` gives the same
guarantee even against a compromised relayer.

## Goal

1. Fix `charge_subscription` to reject any `merchant_ata`/`platform_ata`
   that doesn't match the subscription's stored merchant or the program's
   configured platform wallet.
2. Build the Solana keeper: select due subscriptions, submit
   `charge_subscription`, record the attempt. Charge success/failure
   bookkeeping only — no dunning schedule, no gift subscriptions, no
   scheduled cancellation, no webhooks/emails. Matches the depth the
   listener/writer shipped at (UTXO-indexer-equivalent scope, not full EVM
   parity).

## Non-goals (explicit)

- **Dunning retry schedule, gift-subscription expiry, `cancel_at_period_end`
  handling, webhook dispatch, email sending.** All present in the EVM
  keeper (`packages/indexer/src/keeper.ts`), all deliberately deferred here.
  Failure handling is a fixed threshold (3 consecutive failures → `past_due`),
  not the EVM keeper's `classifyDunningOutcome`/`computeNextRetryAt` backoff
  schedule.
- **`CreateSubscription`/`CreatePayment` account hardening.** Both are
  buyer-signed; the buyer's signature already covers the exact account list.
  Only `ChargeSubscription` gets the new constraints.
- **Compiling or running `anchor test`.** No `cargo`/`anchor` toolchain is
  available in this environment (confirmed: absent both natively and under
  WSL, unlike Foundry which the repo sets up in WSL). The contract fix and
  its test are written from source-level review; the operator runs
  `anchor test` (or CI's `anchor-test.yml`) to confirm.
- **Solana keeper period-math ownership.** `recordSubscriptionCharged`
  (`packages/solana-indexer/src/db-callbacks.ts`, shipped in the prior spec)
  remains the sole owner of `nextChargeDate`/`currentPeriodStart`/
  `currentPeriodEnd` advancement, updated when the listener sees the
  resulting `SubscriptionCharged` event. The keeper does not pre-bump
  `nextChargeDate` the way the EVM keeper does — see Design § Debounce.

## Part A: Contract fix

### `packages/solana-program/programs/paylix_subscription_manager/src/lib.rs`

In the `ChargeSubscription` account struct (currently lines 341-361):

```rust
#[derive(Accounts)]
pub struct ChargeSubscription<'info> {
    #[account(seeds = [b"sub_config"], bump = config.bump)]
    pub config: Account<'info, SubscriptionManagerConfig>,

    #[account(mut, seeds = [b"sub", subscription.id.to_le_bytes().as_ref()], bump = subscription.bump)]
    pub subscription: Account<'info, Subscription>,

    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub buyer_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = subscription.merchant_ata)]
    pub merchant_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = platform_ata.owner == config.platform_wallet @ ErrorCode::PlatformAtaMismatch)]
    pub platform_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,

    /// Keeper or subscriber must sign. Authorization is asserted inside
    /// `charge_subscription` against `config.keeper` / `subscription.subscriber`.
    pub caller: Signer<'info>,
}
```

Two changes from the current source:
- `merchant_ata` gains `address = subscription.merchant_ata` — Anchor's
  built-in address-equality constraint, raises `ConstraintAddress` (a
  standard Anchor error, no new error code needed) if the passed account's
  pubkey doesn't match what was stored at `create_subscription` time.
- `platform_ata` gains `constraint = platform_ata.owner == config.platform_wallet
  @ ErrorCode::PlatformAtaMismatch` — checks the SPL token account's
  `owner` field (the wallet authorized to spend from it, not Solana's
  account-owner-program field; `InterfaceAccount<TokenAccount>` exposes
  this directly) against the platform wallet recorded at `initialize` time.

Add one new variant to the `ErrorCode` enum (currently ending around line
370-379):

```rust
    #[msg("platform_ata does not belong to the configured platform wallet")]
    PlatformAtaMismatch,
```

No changes to `create_subscription`, `create_payment`, `cancel_subscription`,
or any other instruction — see Non-goals.

### Test additions: `packages/solana-program/tests/subscription_manager.ts`

The existing suite creates one subscription (id 0, 60s interval) and never
lets it become due before cancelling it. The new tests need a due
subscription to attempt a charge against, so they create a second
subscription with a 1-second interval, sleep past it, then attempt charges
with wrong accounts before a legitimate one. Add after the existing
`"reverts chargeSubscription when not due yet"` test, before
`"cancel marks the subscription as cancelled"`:

```typescript
  it("reverts chargeSubscription with a merchant_ata that doesn't match the subscription", async () => {
    const amount = new anchor.BN(5_000_000);
    const interval = new anchor.BN(1); // 1 second, so it's due almost immediately
    const productId = Buffer.alloc(32, 5);
    const customerId = Buffer.alloc(32, 6);
    const sub = subPda(1n);

    await approve(provider.connection, buyer, buyerAta, sub, buyer.publicKey, 10_000_000_000);
    await program.methods
      .createSubscription(amount, interval, Array.from(productId), Array.from(customerId))
      .accounts({
        config: subConfig,
        subscription: sub,
        mint,
        buyer: buyer.publicKey,
        buyerAta,
        merchantAta,
        platformAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const rogueAta = await createAssociatedTokenAccount(
      provider.connection,
      owner,
      mint,
      Keypair.generate().publicKey,
    );

    let threw = false;
    try {
      await program.methods
        .chargeSubscription()
        .accounts({
          config: subConfig,
          subscription: sub,
          mint,
          buyerAta,
          merchantAta: rogueAta, // wrong — should be `merchantAta`
          platformAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          caller: provider.wallet.publicKey,
        })
        .rpc();
    } catch (err) {
      threw = /ConstraintAddress|address/i.test(String(err));
    }
    assert.strictEqual(threw, true, "expected chargeSubscription to reject a mismatched merchant_ata");
  });

  it("reverts chargeSubscription with a platform_ata not owned by the platform wallet", async () => {
    const sub = subPda(1n); // still due — the previous test's rejected call didn't consume it

    const rogueAta = await createAssociatedTokenAccount(
      provider.connection,
      owner,
      mint,
      Keypair.generate().publicKey,
    );

    let threw = false;
    try {
      await program.methods
        .chargeSubscription()
        .accounts({
          config: subConfig,
          subscription: sub,
          mint,
          buyerAta,
          merchantAta,
          platformAta: rogueAta, // wrong — should be `platformAta`
          tokenProgram: TOKEN_PROGRAM_ID,
          caller: provider.wallet.publicKey,
        })
        .rpc();
    } catch (err) {
      threw = /PlatformAtaMismatch/i.test(String(err));
    }
    assert.strictEqual(threw, true, "expected chargeSubscription to reject a mismatched platform_ata");
  });

  it("charges successfully with the correct merchant_ata and platform_ata", async () => {
    const sub = subPda(1n);
    await program.methods
      .chargeSubscription()
      .accounts({
        config: subConfig,
        subscription: sub,
        mint,
        buyerAta,
        merchantAta,
        platformAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        caller: provider.wallet.publicKey,
      })
      .rpc();
    const s = await program.account.subscription.fetch(sub);
    assert.strictEqual(s.totalCharged.toNumber(), 10_000_000); // 5_000_000 at creation + 5_000_000 at charge
  });
```

## Part B: Keeper

### `packages/solana-indexer/src/decoder.ts` (modify)

`BorshReader` is currently a private class used only for decoding program
logs. The keeper needs the same primitive readers to decode a fetched
`Subscription` **account** (different data source, same Borsh layout
rules). Export the class and add the one primitive it's missing:

```typescript
export class BorshReader {
  // ... existing constructor/pubkey()/u64()/i64()/bytes32() unchanged ...

  u8(): number {
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }
}
```

(Change `class BorshReader` to `export class BorshReader` — no other
changes to the existing methods.)

### New file: `packages/solana-indexer/src/subscription-account.ts`

Fetches and decodes the on-chain `Subscription` account. This is the
**only** place `merchant_ata` and `mint` are read for a due subscription —
never re-derived from off-chain config, because after the Part A fix, only
the exact on-chain-stored `merchant_ata` will ever be accepted by
`charge_subscription` anyway.

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import { BorshReader } from "./decoder";

export interface OnChainSubscription {
  id: bigint;
  subscriber: string;
  merchantAta: string;
  mint: string;
  amount: bigint;
  intervalSeconds: bigint;
  nextChargeAt: bigint;
  status: number; // 0 = Active, 1 = PastDue, 2 = Cancelled — see SubStatus in lib.rs
}

export function subscriptionPda(programId: PublicKey, onChainId: bigint): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(onChainId);
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("sub"), idBuf], programId);
  return pda;
}

/** Fetch + Borsh-decode a Subscription account. Returns null if the account doesn't exist. */
export async function fetchSubscriptionAccount(
  connection: Connection,
  pda: PublicKey,
): Promise<OnChainSubscription | null> {
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;

  // 8-byte Anchor discriminator, then the Subscription struct fields in
  // declaration order (see `pub struct Subscription` in lib.rs):
  //   id: u64, subscriber: Pubkey, merchant_ata: Pubkey, mint: Pubkey,
  //   amount: u64, interval_seconds: i64, next_charge_at: i64,
  //   product_id: [u8;32], customer_id: [u8;32], total_charged: u64,
  //   status: u8, bump: u8
  const reader = new BorshReader(info.data.subarray(8));
  const id = reader.u64();
  const subscriber = reader.pubkey();
  const merchantAta = reader.pubkey();
  const mint = reader.pubkey();
  const amount = reader.u64();
  const intervalSeconds = reader.i64();
  const nextChargeAt = reader.i64();
  reader.bytes32(); // product_id — unused here
  reader.bytes32(); // customer_id — unused here
  reader.u64(); // total_charged — unused here
  const status = reader.u8();

  return { id, subscriber, merchantAta, mint, amount, intervalSeconds, nextChargeAt, status };
}
```

### New file: `packages/solana-indexer/src/keeper-callbacks.ts`

The DB-touching half of the keeper — mirrors the `db-callbacks.ts` /
`writer.ts` split: `keeper.ts` stays DB-agnostic (dependency-injected
callbacks), this file is the Drizzle-backed implementation.

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { and, eq, lte, or, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "@paylix/db/client";
import { subscriptions } from "@paylix/db/schema";
import { fetchSubscriptionAccount, subscriptionPda } from "./subscription-account";
import type { SolanaDueSubscription } from "./keeper";

const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes — see spec § Debounce
const FAILURE_THRESHOLD = 3;

export interface KeeperCallbacksOptions {
  db: Database;
  connection: Connection;
  networkKey: "solana" | "solana-devnet";
  platformWallet: PublicKey;
}

export function makeSolanaKeeperCallbacks(opts: KeeperCallbacksOptions) {
  const { db, connection, networkKey, platformWallet } = opts;

  async function dueSubscriptions(): Promise<SolanaDueSubscription[]> {
    const now = new Date();
    const debounceCutoff = new Date(now.getTime() - DEBOUNCE_MS);

    const candidates = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.networkKey, networkKey),
          eq(subscriptions.status, "active"),
          lte(subscriptions.nextChargeDate, now),
          or(isNull(subscriptions.lastChargeAttemptAt), lt(subscriptions.lastChargeAttemptAt, debounceCutoff)),
        ),
      );

    const due: SolanaDueSubscription[] = [];
    for (const sub of candidates) {
      if (!sub.contractAddress || !sub.onChainId) continue;
      const programId = new PublicKey(sub.contractAddress);
      const pda = subscriptionPda(programId, BigInt(sub.onChainId));

      // Re-check against the on-chain account, not just the off-chain row —
      // the DB can lag or drift; the chain is authoritative for whether
      // this subscription is actually chargeable right now.
      const onChain = await fetchSubscriptionAccount(connection, pda);
      if (!onChain || onChain.status !== 0) continue; // not Active on-chain
      const nowSec = BigInt(Math.floor(now.getTime() / 1000));
      if (onChain.nextChargeAt > nowSec) continue; // not due on-chain yet

      const mint = new PublicKey(onChain.mint);
      const subscriberAta = await getAssociatedTokenAddress(mint, new PublicKey(onChain.subscriber));
      const platformAta = await getAssociatedTokenAddress(mint, platformWallet);

      due.push({
        subscriptionPda: pda,
        subscriptionId: onChain.id,
        subscriberAta,
        merchantAta: new PublicKey(onChain.merchantAta),
        platformAta,
        mint,
      });
    }
    return due;
  }

  async function onChargeSubmitted(subscriptionId: bigint): Promise<void> {
    await db
      .update(subscriptions)
      .set({ lastChargeAttemptAt: new Date() })
      .where(and(eq(subscriptions.networkKey, networkKey), eq(subscriptions.onChainId, subscriptionId.toString())));
  }

  async function onChargeFailed(subscriptionId: bigint, error: string): Promise<void> {
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.networkKey, networkKey), eq(subscriptions.onChainId, subscriptionId.toString())))
      .limit(1);
    if (!sub) return;

    const newFailureCount = (sub.chargeFailureCount ?? 0) + 1;
    const update: Partial<typeof subscriptions.$inferInsert> = {
      chargeFailureCount: newFailureCount,
      lastChargeError: error,
      lastChargeAttemptAt: new Date(),
    };
    if (newFailureCount >= FAILURE_THRESHOLD) {
      update.status = "past_due";
      update.pastDueSince = sub.pastDueSince ?? new Date();
    }
    await db.update(subscriptions).set(update).where(eq(subscriptions.id, sub.id));
  }

  return { dueSubscriptions, onChargeSubmitted, onChargeFailed };
}
```

### `packages/solana-indexer/src/keeper.ts` (modify)

Two changes:

1. `chargeOne` currently returns `Promise<void>` and never confirms the
   transaction. Change it to return the signature and confirm:

```typescript
async function chargeOne(
  connection: Connection,
  keeper: Keypair,
  programId: PublicKey,
  sub: SolanaDueSubscription,
): Promise<string> {
  const ix = new TransactionInstruction({ /* ...unchanged... */ });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
  const msg = new TransactionMessage({
    payerKey: keeper.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([keeper]);
  const signature = await connection.sendTransaction(tx);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}
```

2. `KeeperOptions` gains two callbacks, and `tick()` calls them instead of
   silently swallowing the per-subscription outcome:

```typescript
export interface KeeperOptions {
  connection: Connection;
  keeper?: Keypair;
  subscriptionManagerProgramId?: PublicKey;
  dueSubscriptions?: () => Promise<SolanaDueSubscription[]>;
  onChargeSubmitted?: (subscriptionId: bigint) => Promise<void>;
  onChargeFailed?: (subscriptionId: bigint, error: string) => Promise<void>;
  intervalMs?: number;
}
```

In `tick()`'s loop (currently `try { await chargeOne(...); charged++; } catch (err) { console.error(...); }`):

```typescript
    for (const sub of due) {
      try {
        const signature = await chargeOne(opts.connection, opts.keeper, opts.subscriptionManagerProgramId, sub);
        console.log(`[solana-keeper] charged ${sub.subscriptionPda.toBase58()} sig=${signature}`);
        await opts.onChargeSubmitted?.(sub.subscriptionId);
        charged++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[solana-keeper] charge for ${sub.subscriptionPda.toBase58()} failed:`, err);
        await opts.onChargeFailed?.(sub.subscriptionId, message).catch((cbErr) =>
          console.error(`[solana-keeper] onChargeFailed callback failed:`, cbErr),
        );
      }
    }
```

No other changes to `keeper.ts` — the skeleton-mode guard (`if (!opts.keeper || !opts.subscriptionManagerProgramId || !opts.dueSubscriptions) return 0;`) stays as-is and now becomes reachable for the first time once `index.ts` supplies all three.

### `packages/solana-indexer/src/index.ts` (modify)

Add keypair loading and two new required env vars, then pass everything
into `startKeeper`:

```typescript
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { makeSolanaKeeperCallbacks } from "./keeper-callbacks";

function loadKeeperKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
```

Inside `main()`, before constructing the keeper:

```typescript
  const keeperKeypair = loadKeeperKeypair(requireEnv("SOLANA_KEEPER_KEYPAIR_PATH"));
  const platformWallet = new PublicKey(requireEnv("SOLANA_PLATFORM_WALLET"));
  const subscriptionManagerProgramId = mgrId ? new PublicKey(mgrId) : undefined;
  const keeperCallbacks = subscriptionManagerProgramId
    ? makeSolanaKeeperCallbacks({ db, connection, networkKey, platformWallet })
    : undefined;

  const keeper = await startKeeper({
    connection,
    keeper: keeperKeypair,
    subscriptionManagerProgramId,
    dueSubscriptions: keeperCallbacks?.dueSubscriptions,
    onChargeSubmitted: keeperCallbacks?.onChargeSubmitted,
    onChargeFailed: keeperCallbacks?.onChargeFailed,
  });
```

(`mgrId` and `db` already exist earlier in `main()` from the prior spec's
work — reused, not reconstructed.)

## Design notes

### Debounce, not pre-bump

EVM's keeper optimistically bumps `nextChargeDate` *before* sending the
transaction, specifically to stop the next tick from re-selecting the same
subscription while a charge is in flight. The Solana keeper can't do that
here without re-opening `recordSubscriptionCharged` (shipped, reviewed,
owns period math per your call above). Instead, `dueSubscriptions()` excludes
any row charged within the last 5 minutes (`lastChargeAttemptAt`), and
`onChargeSubmitted` stamps that timestamp right after a successful send —
before confirmation, matching the "optimistic, before the risky part"
timing intent of the EVM pattern, just applied to a different field. Five
minutes comfortably exceeds the keeper's 60-second tick interval and Solana
finalized-commitment confirmation latency (typically well under 30s), so a
legitimate charge's resulting event should reach the listener and update
`nextChargeDate` well before the debounce window expires and the row
becomes selectable again.

### On-chain re-check in `dueSubscriptions`

The off-chain `subscriptions.status`/`nextChargeDate` can lag the on-chain
`Subscription.status`/`next_charge_at` (e.g. the listener hasn't processed
a recent cancellation yet). `dueSubscriptions()` re-checks both against the
freshly-fetched on-chain account before including a row, so a stale DB row
can't cause an unnecessary (and, post-fix, doomed-to-fail) charge attempt
against an already-cancelled subscription.

## Testing

**Contract (`packages/solana-program/tests/subscription_manager.ts`):** see
Part A — wrong-merchant-ata rejection, wrong-platform-ata rejection,
legitimate charge still succeeds after the fix. Verified by you via
`anchor test`, not by me.

**Keeper (`packages/solana-indexer/src/__tests__/`):**
- `subscription-account.test.ts`: `fetchSubscriptionAccount` correctly
  decodes a hand-constructed Borsh buffer matching the `Subscription`
  layout (including the 8-byte discriminator skip); returns `null` for a
  `getAccountInfo` miss.
- `keeper-callbacks.test.ts`: `dueSubscriptions` excludes rows outside the
  network key, rows not `active`, rows not yet due, rows within the
  debounce window; includes a row whose on-chain account confirms
  active+due; excludes a row whose DB status says active but the on-chain
  account says cancelled. `onChargeSubmitted` sets `lastChargeAttemptAt`.
  `onChargeFailed` increments `chargeFailureCount` and flips to `past_due`
  only at the threshold, not before.
- `keeper.test.ts` (new — no test file currently covers `keeper.ts`; existing
  `__tests__/` has `decoder.test.ts`, `lifecycle.test.ts`, `token-registry.test.ts`,
  `db-callbacks.test.ts`, none of them this file): `tick()` calls
  `onChargeSubmitted` on success and `onChargeFailed` on a `chargeOne`
  rejection, with the correct subscription id and error message in each
  case.

## Risks

- **Keeper keypair file handling.** `SOLANA_KEEPER_KEYPAIR_PATH` points at
  a JSON secret key on disk — standard Solana CLI convention, but the
  operator is responsible for file permissions and keeping it out of the
  Docker image/git history. Out of scope for this spec (deployment
  hygiene, not application code), but worth a line in `SELFHOST.md` when
  this ships.
- **Fixed 3-failure threshold has no backoff.** A subscription that fails
  once will be retried on literally the next tick (60s later) rather than
  with increasing delay — fine at low volume, could hot-loop against a
  consistently-failing RPC endpoint at higher volume. Accepted for MVP per
  the scope decision; EVM-parity dunning is the natural follow-up.
- **`getAssociatedTokenAddress` assumes classic SPL Token, not Token-2022.**
  Same assumption already made in `keeper.ts`'s existing `TOKEN_PROGRAM_ID`
  constant (documented there as accurate for USDC/USDT/PYUSD today). If a
  Token-2022 mint is ever added to `token-registry.ts`, this derivation
  needs a corresponding update — not new risk introduced by this spec, but
  worth restating since the keeper is the second place (after the listener)
  now carrying this assumption.
