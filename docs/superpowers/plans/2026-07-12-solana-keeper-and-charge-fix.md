# Solana Keeper + charge_subscription Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the on-chain `charge_subscription` instruction so it validates `merchant_ata`/`platform_ata` against stored/configured values instead of trusting the caller, then build the Solana keeper (select due subscriptions, submit charges, record the attempt) on top of the fixed contract.

**Architecture:** Two Anchor account constraints close the on-chain gap. The keeper stays split the same way the listener already is: `keeper.ts` (dependency-injected, DB-agnostic, already exists in skeleton form) gets two new callback hooks and a signature-returning `chargeOne`; a new `keeper-callbacks.ts` supplies the Drizzle-backed implementation of those hooks, reading `merchant_ata`/`mint` from a freshly-fetched on-chain `Subscription` account (never re-derived off-chain) via a new `subscription-account.ts` decoder built on `decoder.ts`'s existing Borsh primitives.

**Tech Stack:** Rust/Anchor 0.30.1 (contract), TypeScript, `@solana/web3.js`, `@solana/spl-token`, Drizzle ORM, Vitest.

## Global Constraints

- No dunning schedule, gift-subscription handling, scheduled-cancellation flip, webhooks, or emails in the keeper — fixed 3-consecutive-failure threshold → `past_due`, nothing more.
- Only `ChargeSubscription`'s accounts change in the Anchor program — `CreateSubscription`/`CreatePayment` are buyer-signed and untouched.
- The keeper never pre-bumps `nextChargeDate`/`currentPeriodStart`/`currentPeriodEnd` — `recordSubscriptionCharged` (already shipped) remains the sole owner of period math. The keeper only debounces via `lastChargeAttemptAt` (5-minute window).
- `merchant_ata` for a due subscription always comes from a freshly-fetched on-chain `Subscription` account, never from off-chain config — this is what the contract fix now enforces on-chain too.
- No `cargo`/`anchor` toolchain available in this environment. The contract fix and its test are written from source-level review; verification is the operator's responsibility (`anchor test` or CI's `anchor-test.yml`).

Spec: `docs/superpowers/specs/2026-07-12-solana-keeper-and-charge-fix-design.md`

---

## Task 1: Contract fix — `charge_subscription` account validation

**Files:**
- Modify: `packages/solana-program/programs/paylix_subscription_manager/src/lib.rs`
- Modify: `packages/solana-program/tests/subscription_manager.ts`

**Interfaces:**
- Produces: `ChargeSubscription` account struct now rejects mismatched `merchant_ata`/`platform_ata` at the Anchor constraint layer, before instruction logic runs. No new exported TypeScript types — this task is source-only, verified by the operator running `anchor test`.

This task has no automated red/green cycle available in this environment (no toolchain — see Global Constraints). Write the fix and the tests carefully from source-level review of the existing file; there is no "run it and watch it fail" step to perform here.

- [ ] **Step 1: Add the account constraints**

In `packages/solana-program/programs/paylix_subscription_manager/src/lib.rs`, find the `ChargeSubscription` struct (currently):

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
    #[account(mut)]
    pub merchant_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub platform_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,

    /// Keeper or subscriber must sign. Authorization is asserted inside
    /// `charge_subscription` against `config.keeper` / `subscription.subscriber`.
    pub caller: Signer<'info>,
}
```

Replace the `merchant_ata` and `platform_ata` fields with:

```rust
    #[account(mut, address = subscription.merchant_ata)]
    pub merchant_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = platform_ata.owner == config.platform_wallet @ ErrorCode::PlatformAtaMismatch)]
    pub platform_ata: InterfaceAccount<'info, TokenAccount>,
```

(Every other field and the doc comment above the struct are unchanged.)

- [ ] **Step 2: Add the new error variant**

Find the `ErrorCode` enum (currently ends around the existing variants including `FeeTooHigh`, `AmountTooSmall`, `MathOverflow`, `BadInterval`, `Unauthorized`, `NotActive`, `NotDue`, `AmountZero`, `Paused`). Add:

```rust
    #[msg("platform_ata does not belong to the configured platform wallet")]
    PlatformAtaMismatch,
```

- [ ] **Step 3: Add the test cases**

In `packages/solana-program/tests/subscription_manager.ts`, insert three new `it(...)` blocks between the existing `"reverts chargeSubscription when not due yet"` test and the existing `"cancel marks the subscription as cancelled"` test:

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

- [ ] **Step 4: Commit**

```bash
git add packages/solana-program/programs/paylix_subscription_manager/src/lib.rs packages/solana-program/tests/subscription_manager.ts
git commit -m "fix(solana-program): validate merchant_ata/platform_ata in charge_subscription"
```

- [ ] **Step 5: Flag for operator verification**

This task cannot be verified by the implementer in this environment (no `cargo`/`anchor` toolchain). In the report, state explicitly: "Run `cd packages/solana-program && anchor test` (or `wsl` equivalent if the operator sets up Anchor under WSL) to verify the three new tests pass and the existing suite has no regressions — this could not be run in this environment." Do not claim DONE with test evidence you do not have; use DONE_WITH_CONCERNS if the report format requires a status, with this exact caveat as the concern.

---

## Task 2: On-chain Subscription account decoder

**Files:**
- Modify: `packages/solana-indexer/src/decoder.ts`
- Create: `packages/solana-indexer/src/subscription-account.ts`
- Test: `packages/solana-indexer/src/__tests__/subscription-account.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `export class BorshReader` (from `decoder.ts`, now exported, with a new `u8()` method). `subscriptionPda(programId: PublicKey, onChainId: bigint): PublicKey` and `fetchSubscriptionAccount(connection: Connection, pda: PublicKey): Promise<OnChainSubscription | null>` from `subscription-account.ts`, where `OnChainSubscription` is `{ id: bigint; subscriber: string; merchantAta: string; mint: string; amount: bigint; intervalSeconds: bigint; nextChargeAt: bigint; status: number }`. Used by Task 3.

- [ ] **Step 1: Export `BorshReader` and add `u8()`**

In `packages/solana-indexer/src/decoder.ts`, find:

```typescript
/** Borsh reader — only the primitives Paylix events use. */
class BorshReader {
```

Change to:

```typescript
/** Borsh reader — only the primitives Paylix events use. */
export class BorshReader {
```

Inside the class, after the existing `bytes32()` method, add:

```typescript
  u8(): number {
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }
```

No other changes to `decoder.ts` — every existing method, `decodeProgramData`, and the discriminator map are untouched.

- [ ] **Step 2: Write the failing test**

```typescript
// packages/solana-indexer/src/__tests__/subscription-account.test.ts
import { describe, it, expect, vi } from "vitest";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { subscriptionPda, fetchSubscriptionAccount } from "../subscription-account";

function buildSubscriptionAccountData(fields: {
  id: bigint;
  subscriber: PublicKey;
  merchantAta: PublicKey;
  mint: PublicKey;
  amount: bigint;
  intervalSeconds: bigint;
  nextChargeAt: bigint;
  status: number;
}): Buffer {
  const buf = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 8 + 8 + 8 + 32 + 32 + 8 + 1 + 1);
  let offset = 0;
  buf.write("00000000", offset, "hex"); // 8-byte discriminator, value irrelevant for decode
  offset += 8;
  buf.writeBigUInt64LE(fields.id, offset); offset += 8;
  fields.subscriber.toBuffer().copy(buf, offset); offset += 32;
  fields.merchantAta.toBuffer().copy(buf, offset); offset += 32;
  fields.mint.toBuffer().copy(buf, offset); offset += 32;
  buf.writeBigUInt64LE(fields.amount, offset); offset += 8;
  buf.writeBigInt64LE(fields.intervalSeconds, offset); offset += 8;
  buf.writeBigInt64LE(fields.nextChargeAt, offset); offset += 8;
  offset += 32; // product_id — zero-filled, unused
  offset += 32; // customer_id — zero-filled, unused
  buf.writeBigUInt64LE(0n, offset); offset += 8; // total_charged — unused
  buf.writeUInt8(fields.status, offset); offset += 1;
  buf.writeUInt8(0, offset); // bump — unused

  return buf;
}

describe("subscriptionPda", () => {
  it("derives the same PDA the Rust program uses (seeds = [\"sub\", id_le_bytes])", () => {
    const programId = Keypair.generate().publicKey;
    const pda = subscriptionPda(programId, 0n);
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(0n);
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from("sub"), idBuf], programId);
    expect(pda.toBase58()).toBe(expected.toBase58());
  });
});

describe("fetchSubscriptionAccount", () => {
  it("decodes a Subscription account", async () => {
    const subscriber = Keypair.generate().publicKey;
    const merchantAta = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const data = buildSubscriptionAccountData({
      id: 42n,
      subscriber,
      merchantAta,
      mint,
      amount: 1_000_000n,
      intervalSeconds: 2_592_000n,
      nextChargeAt: 1_800_000_000n,
      status: 0,
    });

    const connection = {
      getAccountInfo: vi.fn(async () => ({ data, executable: false, lamports: 0, owner: PublicKey.default, rentEpoch: 0 })),
    } as unknown as Connection;

    const result = await fetchSubscriptionAccount(connection, Keypair.generate().publicKey);

    expect(result).toEqual({
      id: 42n,
      subscriber: subscriber.toBase58(),
      merchantAta: merchantAta.toBase58(),
      mint: mint.toBase58(),
      amount: 1_000_000n,
      intervalSeconds: 2_592_000n,
      nextChargeAt: 1_800_000_000n,
      status: 0,
    });
  });

  it("returns null when the account doesn't exist", async () => {
    const connection = {
      getAccountInfo: vi.fn(async () => null),
    } as unknown as Connection;

    const result = await fetchSubscriptionAccount(connection, Keypair.generate().publicKey);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @paylix/solana-indexer test -- subscription-account`
Expected: FAIL with "Cannot find module '../subscription-account'"

- [ ] **Step 4: Write the implementation**

```typescript
// packages/solana-indexer/src/subscription-account.ts
/**
 * Fetches and decodes the on-chain Subscription account for the Solana
 * SubscriptionManager program. This is the only place merchant_ata and mint
 * are read for a due subscription — never re-derived off-chain, since
 * charge_subscription now rejects any merchant_ata that doesn't match this
 * exact on-chain value.
 */

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @paylix/solana-indexer test -- subscription-account`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full package suite and typecheck**

Run: `pnpm --filter @paylix/solana-indexer test` — expect all prior tests (31) plus these 3 to pass, no regressions.
Run: `pnpm --filter @paylix/solana-indexer exec tsc --noEmit` — expect zero errors.

- [ ] **Step 7: Commit**

```bash
git add packages/solana-indexer/src/decoder.ts packages/solana-indexer/src/subscription-account.ts packages/solana-indexer/src/__tests__/subscription-account.test.ts
git commit -m "feat(solana): decode on-chain Subscription account"
```

---

## Task 3: Keeper DB callbacks (`dueSubscriptions`, `onChargeSubmitted`, `onChargeFailed`)

**Files:**
- Create: `packages/solana-indexer/src/keeper-callbacks.ts`
- Test: `packages/solana-indexer/src/__tests__/keeper-callbacks.test.ts`

**Interfaces:**
- Consumes: `fetchSubscriptionAccount`, `subscriptionPda` from `./subscription-account` (Task 2). `SolanaDueSubscription` type from `./keeper` (already exists, unchanged by this task).
- Produces: `makeSolanaKeeperCallbacks(opts: { db: Database; connection: Connection; networkKey: "solana" | "solana-devnet"; platformWallet: PublicKey }): { dueSubscriptions: () => Promise<SolanaDueSubscription[]>; onChargeSubmitted: (subscriptionId: bigint) => Promise<void>; onChargeFailed: (subscriptionId: bigint, error: string) => Promise<void> }`. Used by Task 5 (`index.ts` wiring).

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/solana-indexer/src/__tests__/keeper-callbacks.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { makeSolanaKeeperCallbacks } from "../keeper-callbacks";
import * as subscriptionAccount from "../subscription-account";

type QueryResult = unknown[];

const selectResults: QueryResult[] = [];
const updateCalls: Array<{ set: Record<string, unknown> }> = [];

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "where", "limit"];
  for (const m of methods) chain[m] = () => chain;
  (chain as { then: (resolve: (v: QueryResult) => void) => void }).then = (resolve) => {
    resolve(selectResults.shift() ?? []);
  };
  return chain;
}

function makeUpdateChain() {
  const captured: { set: Record<string, unknown> } = { set: {} };
  const chain: Record<string, unknown> = {
    set: (v: Record<string, unknown>) => {
      captured.set = v;
      return chain;
    },
    where: () => chain,
  };
  (chain as { then: (resolve: (v: QueryResult) => void) => void }).then = (resolve) => {
    updateCalls.push(captured);
    resolve([]);
  };
  return chain;
}

const mockDb = {
  select: vi.fn(() => makeSelectChain()),
  update: vi.fn(() => makeUpdateChain()),
};

beforeEach(() => {
  selectResults.length = 0;
  updateCalls.length = 0;
  mockDb.select.mockClear();
  mockDb.update.mockClear();
  vi.restoreAllMocks();
});

const PROGRAM_ID = Keypair.generate().publicKey;
const PLATFORM_WALLET = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;
const MERCHANT_ATA = Keypair.generate().publicKey;
const SUBSCRIBER = Keypair.generate().publicKey;

function dueRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sub_row_1",
    networkKey: "solana",
    status: "active",
    contractAddress: PROGRAM_ID.toBase58(),
    onChainId: "42",
    chargeFailureCount: 0,
    pastDueSince: null,
    ...overrides,
  };
}

describe("makeSolanaKeeperCallbacks().dueSubscriptions", () => {
  it("includes a row whose on-chain account confirms active and due", async () => {
    selectResults.push([dueRow()]);
    vi.spyOn(subscriptionAccount, "fetchSubscriptionAccount").mockResolvedValue({
      id: 42n,
      subscriber: SUBSCRIBER.toBase58(),
      merchantAta: MERCHANT_ATA.toBase58(),
      mint: MINT.toBase58(),
      amount: 1_000_000n,
      intervalSeconds: 2_592_000n,
      nextChargeAt: 0n, // long past due
      status: 0, // Active
    });

    const callbacks = makeSolanaKeeperCallbacks({
      db: mockDb as never,
      connection: {} as Connection,
      networkKey: "solana",
      platformWallet: PLATFORM_WALLET,
    });
    const due = await callbacks.dueSubscriptions();

    expect(due).toHaveLength(1);
    expect(due[0].subscriptionId).toBe(42n);
    expect(due[0].merchantAta.toBase58()).toBe(MERCHANT_ATA.toBase58());
    expect(due[0].mint.toBase58()).toBe(MINT.toBase58());
  });

  it("excludes a row whose DB status is active but the on-chain account says cancelled", async () => {
    selectResults.push([dueRow()]);
    vi.spyOn(subscriptionAccount, "fetchSubscriptionAccount").mockResolvedValue({
      id: 42n,
      subscriber: SUBSCRIBER.toBase58(),
      merchantAta: MERCHANT_ATA.toBase58(),
      mint: MINT.toBase58(),
      amount: 1_000_000n,
      intervalSeconds: 2_592_000n,
      nextChargeAt: 0n,
      status: 2, // Cancelled
    });

    const callbacks = makeSolanaKeeperCallbacks({
      db: mockDb as never,
      connection: {} as Connection,
      networkKey: "solana",
      platformWallet: PLATFORM_WALLET,
    });
    const due = await callbacks.dueSubscriptions();

    expect(due).toHaveLength(0);
  });

  it("excludes a row with no on-chain account (fetchSubscriptionAccount returns null)", async () => {
    selectResults.push([dueRow()]);
    vi.spyOn(subscriptionAccount, "fetchSubscriptionAccount").mockResolvedValue(null);

    const callbacks = makeSolanaKeeperCallbacks({
      db: mockDb as never,
      connection: {} as Connection,
      networkKey: "solana",
      platformWallet: PLATFORM_WALLET,
    });
    const due = await callbacks.dueSubscriptions();

    expect(due).toHaveLength(0);
  });

  it("excludes a row missing contractAddress or onChainId", async () => {
    selectResults.push([dueRow({ contractAddress: null })]);

    const callbacks = makeSolanaKeeperCallbacks({
      db: mockDb as never,
      connection: {} as Connection,
      networkKey: "solana",
      platformWallet: PLATFORM_WALLET,
    });
    const due = await callbacks.dueSubscriptions();

    expect(due).toHaveLength(0);
  });
});

describe("makeSolanaKeeperCallbacks().onChargeSubmitted", () => {
  it("sets lastChargeAttemptAt", async () => {
    const callbacks = makeSolanaKeeperCallbacks({
      db: mockDb as never,
      connection: {} as Connection,
      networkKey: "solana",
      platformWallet: PLATFORM_WALLET,
    });
    await callbacks.onChargeSubmitted(42n);

    expect(updateCalls[0].set.lastChargeAttemptAt).toBeInstanceOf(Date);
  });
});

describe("makeSolanaKeeperCallbacks().onChargeFailed", () => {
  it("increments chargeFailureCount without flipping status below the threshold", async () => {
    selectResults.push([dueRow({ chargeFailureCount: 1 })]);

    const callbacks = makeSolanaKeeperCallbacks({
      db: mockDb as never,
      connection: {} as Connection,
      networkKey: "solana",
      platformWallet: PLATFORM_WALLET,
    });
    await callbacks.onChargeFailed(42n, "RPC timeout");

    expect(updateCalls[0].set).toMatchObject({ chargeFailureCount: 2, lastChargeError: "RPC timeout" });
    expect(updateCalls[0].set.status).toBeUndefined();
  });

  it("flips to past_due at the failure threshold", async () => {
    selectResults.push([dueRow({ chargeFailureCount: 2 })]); // this failure makes it 3

    const callbacks = makeSolanaKeeperCallbacks({
      db: mockDb as never,
      connection: {} as Connection,
      networkKey: "solana",
      platformWallet: PLATFORM_WALLET,
    });
    await callbacks.onChargeFailed(42n, "insufficient funds");

    expect(updateCalls[0].set).toMatchObject({ chargeFailureCount: 3, status: "past_due" });
    expect(updateCalls[0].set.pastDueSince).toBeInstanceOf(Date);
  });

  it("does nothing when no subscription row matches", async () => {
    selectResults.push([]);

    const callbacks = makeSolanaKeeperCallbacks({
      db: mockDb as never,
      connection: {} as Connection,
      networkKey: "solana",
      platformWallet: PLATFORM_WALLET,
    });
    await expect(callbacks.onChargeFailed(999n, "not found")).resolves.not.toThrow();
    expect(updateCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @paylix/solana-indexer test -- keeper-callbacks`
Expected: FAIL with "Cannot find module '../keeper-callbacks'"

- [ ] **Step 3: Write the implementation**

```typescript
// packages/solana-indexer/src/keeper-callbacks.ts
/**
 * Drizzle-backed implementation of the keeper's due-subscription lookup and
 * charge-outcome recording. Mirrors the db-callbacks.ts / writer.ts split:
 * keeper.ts stays DB-agnostic, this file supplies the callbacks.
 *
 * merchant_ata and mint always come from a freshly-fetched on-chain
 * Subscription account (see subscription-account.ts) — never re-derived
 * off-chain, since charge_subscription now rejects any merchant_ata that
 * doesn't match the on-chain-stored value.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { and, eq, lte, or, isNull, lt } from "drizzle-orm";
import type { Database } from "@paylix/db/client";
import { subscriptions } from "@paylix/db/schema";
import { fetchSubscriptionAccount, subscriptionPda } from "./subscription-account";
import type { SolanaDueSubscription } from "./keeper";

const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paylix/solana-indexer test -- keeper-callbacks`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the full package suite and typecheck**

Run: `pnpm --filter @paylix/solana-indexer test` — expect 34 (31 prior + 3 from Task 2) plus these 7 = 41 to pass.
Run: `pnpm --filter @paylix/solana-indexer exec tsc --noEmit` — expect zero errors.

- [ ] **Step 6: Commit**

```bash
git add packages/solana-indexer/src/keeper-callbacks.ts packages/solana-indexer/src/__tests__/keeper-callbacks.test.ts
git commit -m "feat(solana): keeper DB callbacks for due-subscription lookup and charge outcomes"
```

---

## Task 4: `keeper.ts` — signature-returning charge + outcome callbacks

**Files:**
- Modify: `packages/solana-indexer/src/keeper.ts`
- Test: `packages/solana-indexer/src/__tests__/keeper.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks (this task only changes `keeper.ts`'s own shape).
- Produces: `chargeOne` now returns `Promise<string>` (the signature) instead of `Promise<void>`. `KeeperOptions` gains `onChargeSubmitted?: (subscriptionId: bigint) => Promise<void>` and `onChargeFailed?: (subscriptionId: bigint, error: string) => Promise<void>`. Used by Task 5 (`index.ts` wiring, passing the Task 3 callbacks through).

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/solana-indexer/src/__tests__/keeper.test.ts
import { describe, it, expect, vi } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { startKeeper, type SolanaDueSubscription } from "../keeper";

function fakeDueSubscription(): SolanaDueSubscription {
  return {
    subscriptionPda: Keypair.generate().publicKey,
    subscriptionId: 42n,
    subscriberAta: Keypair.generate().publicKey,
    merchantAta: Keypair.generate().publicKey,
    platformAta: Keypair.generate().publicKey,
    mint: Keypair.generate().publicKey,
  };
}

function fakeConnection(opts: { sendShouldThrow?: boolean } = {}): Connection {
  return {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: "fakeblockhash", lastValidBlockHeight: 100 })),
    sendTransaction: vi.fn(async () => {
      if (opts.sendShouldThrow) throw new Error("simulated send failure");
      return "fakesignature";
    }),
    confirmTransaction: vi.fn(async () => ({ value: { err: null } })),
  } as unknown as Connection;
}

describe("startKeeper tick()", () => {
  it("calls onChargeSubmitted with the subscription id on a successful charge", async () => {
    const due = fakeDueSubscription();
    const onChargeSubmitted = vi.fn(async () => {});
    const onChargeFailed = vi.fn(async () => {});

    const handle = await startKeeper({
      connection: fakeConnection(),
      keeper: Keypair.generate(),
      subscriptionManagerProgramId: Keypair.generate().publicKey,
      dueSubscriptions: async () => [due],
      onChargeSubmitted,
      onChargeFailed,
    });

    const charged = await handle.tick();

    expect(charged).toBe(1);
    expect(onChargeSubmitted).toHaveBeenCalledWith(42n);
    expect(onChargeFailed).not.toHaveBeenCalled();

    await handle.stop();
  });

  it("calls onChargeFailed with the subscription id and error message when the send fails", async () => {
    const due = fakeDueSubscription();
    const onChargeSubmitted = vi.fn(async () => {});
    const onChargeFailed = vi.fn(async () => {});

    const handle = await startKeeper({
      connection: fakeConnection({ sendShouldThrow: true }),
      keeper: Keypair.generate(),
      subscriptionManagerProgramId: Keypair.generate().publicKey,
      dueSubscriptions: async () => [due],
      onChargeSubmitted,
      onChargeFailed,
    });

    const charged = await handle.tick();

    expect(charged).toBe(0);
    expect(onChargeSubmitted).not.toHaveBeenCalled();
    expect(onChargeFailed).toHaveBeenCalledWith(42n, expect.stringContaining("simulated send failure"));

    await handle.stop();
  });

  it("stays in skeleton mode (returns 0, calls neither callback) when keeper/programId/dueSubscriptions are missing", async () => {
    const onChargeSubmitted = vi.fn(async () => {});
    const onChargeFailed = vi.fn(async () => {});

    const handle = await startKeeper({
      connection: fakeConnection(),
      onChargeSubmitted,
      onChargeFailed,
    });

    const charged = await handle.tick();

    expect(charged).toBe(0);
    expect(onChargeSubmitted).not.toHaveBeenCalled();
    expect(onChargeFailed).not.toHaveBeenCalled();

    await handle.stop();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @paylix/solana-indexer test -- keeper.test`
Expected: FAIL — `onChargeSubmitted`/`onChargeFailed` are not valid `KeeperOptions` fields yet (type error) and/or the callbacks are never invoked by the current `tick()`.

- [ ] **Step 3: Modify `chargeOne` and `KeeperOptions`/`tick()`**

In `packages/solana-indexer/src/keeper.ts`, change the `chargeOne` function signature and body (currently ending with `await connection.sendTransaction(tx);` and no return):

```typescript
async function chargeOne(
  connection: Connection,
  keeper: Keypair,
  programId: PublicKey,
  sub: SolanaDueSubscription,
): Promise<string> {
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda(programId), isSigner: false, isWritable: false },
      { pubkey: sub.subscriptionPda, isSigner: false, isWritable: true },
      { pubkey: sub.mint, isSigner: false, isWritable: false },
      { pubkey: sub.subscriberAta, isSigner: false, isWritable: true },
      { pubkey: sub.merchantAta, isSigner: false, isWritable: true },
      { pubkey: sub.platformAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: keeper.publicKey, isSigner: true, isWritable: false },
    ],
    data: CHARGE_SUBSCRIPTION_DISC,
  });

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

Change `KeeperOptions` (currently ending with `intervalMs?: number;`):

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

Change the `tick()` function's charge loop (currently):

```typescript
    const due = await opts.dueSubscriptions();
    let charged = 0;
    for (const sub of due) {
      try {
        await chargeOne(opts.connection, opts.keeper, opts.subscriptionManagerProgramId, sub);
        charged++;
      } catch (err) {
        console.error(`[solana-keeper] charge for ${sub.subscriptionPda.toBase58()} failed:`, err);
      }
    }
    return charged;
```

to:

```typescript
    const due = await opts.dueSubscriptions();
    let charged = 0;
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
    return charged;
```

No other changes to `keeper.ts` — the skeleton-mode guard, `schedule()`, `startKeeper`'s return shape, `configPda`, `chargeSubscriptionDiscriminator`, and the `TOKEN_PROGRAM_ID` constant are all unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paylix/solana-indexer test -- keeper.test`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full package suite and typecheck**

Run: `pnpm --filter @paylix/solana-indexer test` — expect 41 (from Task 3) + 3 = 44 to pass, including the existing `lifecycle.test.ts` (which exercises `startKeeper` in skeleton mode with none of the new fields — confirm it still passes unmodified, since `KeeperOptions`'s new fields are optional).
Run: `pnpm --filter @paylix/solana-indexer exec tsc --noEmit` — expect zero errors.

- [ ] **Step 6: Commit**

```bash
git add packages/solana-indexer/src/keeper.ts packages/solana-indexer/src/__tests__/keeper.test.ts
git commit -m "feat(solana): keeper reports charge outcomes via callbacks"
```

---

## Task 5: Wire `index.ts` — keypair loading, env vars, keeper construction

**Files:**
- Modify: `packages/solana-indexer/src/index.ts`

**Interfaces:**
- Consumes: `makeSolanaKeeperCallbacks` (Task 3), the modified `startKeeper`/`KeeperOptions` (Task 4).

- [ ] **Step 1: Add imports and the keypair loader**

At the top of `packages/solana-indexer/src/index.ts`, alongside the existing imports:

```typescript
import { readFileSync } from "node:fs";
import { makeSolanaKeeperCallbacks } from "./keeper-callbacks";
```

(`Keypair` is likely already imported from `@solana/web3.js` — check the current import line; if only `Connection, PublicKey` are imported, add `Keypair` to that same import.)

After the existing `requireNetworkKey` function, add:

```typescript
function loadKeeperKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
```

- [ ] **Step 2: Wire the keeper construction**

Find the current keeper construction inside `main()`:

```typescript
  const keeper = await startKeeper({
    connection,
    // Keeper charging (keypair load + due-subscription query) is a separate
    // follow-up — see docs/superpowers/specs/2026-07-11-solana-indexer-db-writer-design.md.
    // Listener-side DB wiring above is complete; this is the keeper's own gap.
  });
```

Replace with:

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

(`mgrId` and `db` are already defined earlier in `main()` from the prior spec's work — read the current file to confirm their exact variable names before wiring; they should be `mgrId` for `process.env.SOLANA_SUBSCRIPTION_MANAGER_PROGRAM_ID` and `db` for the `createDb(...)` call. If either was named differently, use the actual name.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @paylix/solana-indexer exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full package test suite**

Run: `pnpm --filter @paylix/solana-indexer test`
Expected: PASS — all 44 tests from Tasks 1-4 (Task 1 has no TS tests, it's the contract task).

- [ ] **Step 5: Commit**

```bash
git add packages/solana-indexer/src/index.ts
git commit -m "feat(solana): wire keeper keypair, platform wallet, callbacks in index.ts"
```

---

## Final Verification

- [ ] Run `pnpm --filter @paylix/solana-indexer test` — all tests pass (44 total: 31 from the prior plan + 3 subscription-account + 7 keeper-callbacks + 3 keeper).
- [ ] Run `pnpm --filter @paylix/solana-indexer exec tsc --noEmit` — no type errors.
- [ ] Run `pnpm lint` from repo root — no new lint errors introduced.
- [ ] Grep `packages/solana-indexer/src` for the string `"not implemented"` — zero matches (unchanged from the prior plan's state; this plan doesn't reintroduce any).
- [ ] Confirm `packages/solana-indexer/src/__tests__/lifecycle.test.ts` still passes unmodified — it exercises `startKeeper` in skeleton mode and must not have been broken by Task 4's additive changes.
- [ ] Manually confirm the Task 1 contract diff (`git show` the commit) is what actually shipped — since it can't be compiled/tested here, a careful final read against the spec's exact constraint syntax is the last line of defense before asking the operator to run `anchor test`.
- [ ] Remind the operator (in the final summary, not as a task) that `anchor test` still needs to run before this is truly verified end-to-end, and that `SOLANA_KEEPER_KEYPAIR_PATH` / `SOLANA_PLATFORM_WALLET` need to be added to deployment env configuration and `SELFHOST.md` before this ships to any real environment.
