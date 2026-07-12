# Solana Indexer Postgres Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Solana indexer's `console.log`-only event handler with a real Drizzle-backed Postgres writer, so Solana payments and subscriptions actually persist to the shared schema — closing the gap between closed issue #65 ("Postgres bindings for Solana + UTXO indexers") and the code, which only ever wired the UTXO side.

**Architecture:** A new `db-callbacks.ts` in `packages/solana-indexer` implements the existing `WriterCallbacks` interface (`packages/solana-indexer/src/writer.ts`) using Drizzle, matching the depth and error-handling posture already shipped in `packages/utxo-indexer/src/db-callbacks.ts`: payment/subscription rows written on match, checkout-session status transitions, and `unmatched_events` retention on any miss (session-matching miss, unrecognized mint, or unknown subscription). `index.ts` is wired to construct this writer and pass it to `makeEventHandler`. Keeper wiring (charging subscriptions) is explicitly out of scope for this plan.

**Tech Stack:** TypeScript, Drizzle ORM (`@paylix/db`), Vitest, `viem` (`keccak256`/`stringToBytes` for session-matching hashes, same scheme already used by the EVM indexer and the Solana checkout client).

## Global Constraints

- Prices/amounts are integer cents in the `payments` table (`packages/db/src/schema/payments.ts:15-16` — `amount`/`fee` are `integer`). Never store floats.
- No changes to `@paylix/config` — `NETWORKS`/`getToken` are EVM-only by design (`packages/config/src/__tests__/networks.test.ts:326-328,453,492` assert `"solana"` is an invalid `NetworkKey`). Token resolution for Solana stays local to `solana-indexer`.
- No schema migration — `payments`, `subscriptions`, `checkoutSessions`, `unmatchedEvents` are already chain-agnostic (`networkKey`/`chain` are `text`).
- No webhook/invoice/email side effects in this pass (see spec's Non-goals). No keeper wiring in this pass.
- Match session-matching convention exactly: on-chain `customerId` = `keccak256(stringToBytes(session.id))`, `productId` = `keccak256(stringToBytes(product.id))` (`apps/web/app/checkout/[sessionId]/solana-pay.tsx:64-103`).

Spec: `docs/superpowers/specs/2026-07-11-solana-indexer-db-writer-design.md`

---

## Task 1: Token registry (`resolveMint`)

**Files:**
- Create: `packages/solana-indexer/src/token-registry.ts`
- Test: `packages/solana-indexer/src/__tests__/token-registry.test.ts`

**Interfaces:**
- Produces: `resolveMint(networkKey: "solana" | "solana-devnet", mint: string): { symbol: string; decimals: number }` — throws `Error` on an unrecognized mint. Used by Task 2-4.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/solana-indexer/src/__tests__/token-registry.test.ts
import { describe, it, expect } from "vitest";
import { resolveMint } from "../token-registry";

describe("resolveMint", () => {
  it("resolves USDC on mainnet", () => {
    expect(resolveMint("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toEqual({
      symbol: "USDC",
      decimals: 6,
    });
  });

  it("resolves USDT on mainnet", () => {
    expect(resolveMint("solana", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")).toEqual({
      symbol: "USDT",
      decimals: 6,
    });
  });

  it("resolves PYUSD on mainnet", () => {
    expect(resolveMint("solana", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo")).toEqual({
      symbol: "PYUSD",
      decimals: 6,
    });
  });

  it("resolves USDC on devnet", () => {
    expect(resolveMint("solana-devnet", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")).toEqual({
      symbol: "USDC",
      decimals: 6,
    });
  });

  it("throws on an unrecognized mint", () => {
    expect(() => resolveMint("solana", "11111111111111111111111111111111")).toThrow(
      /unrecognized mint/i,
    );
  });

  it("throws with the mint address in the message for debuggability", () => {
    expect(() => resolveMint("solana", "BadMint111111111111111111111111111111111")).toThrow(
      /BadMint111111111111111111111111111111111/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @paylix/solana-indexer test -- token-registry`
Expected: FAIL with "Cannot find module '../token-registry'"

- [ ] **Step 3: Write the implementation**

```typescript
// packages/solana-indexer/src/token-registry.ts
/**
 * Static Solana mint -> token map. Deliberately NOT part of @paylix/config —
 * that package's NetworkKey type is EVM-only by design (see
 * packages/config/src/__tests__/networks.test.ts, which asserts "solana" is
 * an invalid key). Three tokens, two clusters; a full registry would be
 * over-engineering for this surface.
 *
 * Devnet mint addresses are placeholders from the paylix devnet token
 * deployment tracked alongside the Anchor program deploy scripts — update
 * this map if those addresses change.
 */

export interface SolanaTokenInfo {
  symbol: string;
  decimals: number;
}

const MAINNET_MINTS: Record<string, SolanaTokenInfo> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": { symbol: "PYUSD", decimals: 6 },
};

const DEVNET_MINTS: Record<string, SolanaTokenInfo> = {
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": { symbol: "USDC", decimals: 6 },
};

export function resolveMint(
  networkKey: "solana" | "solana-devnet",
  mint: string,
): SolanaTokenInfo {
  const table = networkKey === "solana" ? MAINNET_MINTS : DEVNET_MINTS;
  const info = table[mint];
  if (!info) {
    throw new Error(`resolveMint: unrecognized mint ${mint} on ${networkKey}`);
  }
  return info;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paylix/solana-indexer test -- token-registry`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/solana-indexer/src/token-registry.ts packages/solana-indexer/src/__tests__/token-registry.test.ts
git commit -m "feat(solana): add mint-to-token registry"
```

---

## Task 2: `db-callbacks.ts` — `recordPayment`

**Files:**
- Create: `packages/solana-indexer/src/db-callbacks.ts`
- Test: `packages/solana-indexer/src/__tests__/db-callbacks.test.ts`
- Modify: `packages/solana-indexer/package.json` (add `viem` dependency)

**Interfaces:**
- Consumes: `resolveMint` from Task 1. `WriterCallbacks` type from `packages/solana-indexer/src/writer.ts:15-57`. `Database` type from `@paylix/db/client`. Schema tables `payments`, `checkoutSessions`, `unmatchedEvents` from `@paylix/db/schema`.
- Produces: `makeSolanaDbCallbacks(opts: { db: Database; networkKey: "solana" | "solana-devnet" }): WriterCallbacks` — the full interface is built out across Tasks 2-5; this task implements `recordPayment` and stubs the other three methods to throw `Error("not implemented")` so the file compiles and satisfies `WriterCallbacks`. Tasks 3-5 replace each stub in turn.

This task also establishes the **test mock-db pattern** reused by Tasks 3-5: a hand-rolled thenable chain mock, same shape as the one in `packages/indexer/src/__tests__/handle-subscription-created-trial.test.ts:80-143`, adapted to support rejecting (for the duplicate-insert test) and passed directly as the `db` constructor argument (no `vi.mock` needed, since `makeSolanaDbCallbacks` takes `db` as a parameter rather than importing a module-level client).

- [ ] **Step 1: Add `viem` dependency**

Edit `packages/solana-indexer/package.json`, add to `dependencies` (alongside the existing `@paylix/config`):

```json
    "viem": "^2"
```

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 2: Write the failing tests**

```typescript
// packages/solana-indexer/src/__tests__/db-callbacks.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { keccak256, stringToBytes } from "viem";
import { makeSolanaDbCallbacks } from "../db-callbacks";

type QueryResult = unknown[];

const selectResults: QueryResult[] = [];
const insertResults: Array<QueryResult | Error> = [];
const updateCalls: Array<{ set: Record<string, unknown> }> = [];
const insertCalls: Array<{ table: string; values: unknown }> = [];

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "where", "orderBy", "limit", "innerJoin"];
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

function makeInsertChain(table: string) {
  const captured: { values: unknown } = { values: null };
  const chain: Record<string, unknown> = {
    values: (v: unknown) => {
      captured.values = v;
      return chain;
    },
  };
  (chain as {
    then: (resolve: (v: QueryResult) => void, reject: (e: unknown) => void) => void;
  }).then = (resolve, reject) => {
    insertCalls.push({ table, values: captured.values });
    const next = insertResults.shift() ?? [];
    if (next instanceof Error) reject(next);
    else resolve(next);
  };
  return chain;
}

// Table objects imported from @paylix/db/schema are distinct object
// identities; we tag which table an insert/select targets by object
// reference so the mock can route correctly.
import { payments, checkoutSessions, unmatchedEvents } from "@paylix/db/schema";

const mockDb = {
  select: vi.fn(() => makeSelectChain()),
  update: vi.fn((_table: unknown) => makeUpdateChain()),
  insert: vi.fn((table: unknown) => {
    const name =
      table === payments ? "payments" : table === unmatchedEvents ? "unmatchedEvents" : "checkoutSessions";
    return makeInsertChain(name);
  }),
};

beforeEach(() => {
  selectResults.length = 0;
  insertResults.length = 0;
  updateCalls.length = 0;
  insertCalls.length = 0;
  mockDb.select.mockClear();
  mockDb.update.mockClear();
  mockDb.insert.mockClear();
});

const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";
const CUSTOMER_UUID = "660e8400-e29b-41d4-a716-446655440000";

function matchingSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SESSION_ID,
    organizationId: "org_1",
    productId: "prod_1",
    customerId: CUSTOMER_UUID,
    merchantWallet: "merchant_pubkey",
    amount: 1000000n,
    tokenSymbol: "USDC",
    livemode: false,
    status: "active",
    ...overrides,
  };
}

const basePaymentEvent = {
  signature: "sig_1",
  slot: 100,
  programId: "prog_vault",
  buyer: "buyer_pubkey",
  merchant: "merchant_pubkey",
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC mainnet
  amount: 1_000_000n, // $1.00 at 6 decimals
  fee: 5_000n, // $0.005
  productId: keccak256(stringToBytes("prod_1")),
  customerId: keccak256(stringToBytes(SESSION_ID)),
};

describe("makeSolanaDbCallbacks().recordPayment", () => {
  it("inserts a payment row and completes the session on a match", async () => {
    selectResults.push([matchingSession()]); // session candidates query

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordPayment(basePaymentEvent);

    const paymentInsert = insertCalls.find((c) => c.table === "payments");
    expect(paymentInsert).toBeDefined();
    expect(paymentInsert!.values).toMatchObject({
      productId: "prod_1",
      organizationId: "org_1",
      customerId: CUSTOMER_UUID,
      amount: 100, // 1_000_000 / 10^(6-2) = 100 cents
      fee: 0.5, // see rounding note in implementation step
      status: "confirmed",
      txHash: "sig_1",
      chain: "solana",
      token: "USDC",
      fromAddress: "buyer_pubkey",
      toAddress: "merchant_pubkey",
      blockNumber: 100,
      livemode: false,
    });
    expect(updateCalls[0].set).toMatchObject({ status: "completed" });
    expect(updateCalls[0].set.completedAt).toBeInstanceOf(Date);
  });

  it("records an unmatched event when no session matches", async () => {
    selectResults.push([]); // no candidates

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordPayment(basePaymentEvent);

    const unmatchedInsert = insertCalls.find((c) => c.table === "unmatchedEvents");
    expect(unmatchedInsert).toBeDefined();
    expect(unmatchedInsert!.values).toMatchObject({
      eventType: "SolanaPaymentReceived",
      txHash: "sig_1",
      blockNumber: 100,
      livemode: true, // networkKey === "solana" => livemode true
    });
    expect(insertCalls.find((c) => c.table === "payments")).toBeUndefined();
  });

  it("does not throw when the payment insert hits a duplicate unique constraint", async () => {
    selectResults.push([matchingSession()]);
    insertResults.push(new Error("duplicate key value violates unique constraint \"payments_chain_tx_idx\""));

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await expect(callbacks.recordPayment(basePaymentEvent)).resolves.not.toThrow();

    // Session still gets flipped to completed even though the payment insert raced.
    expect(updateCalls[0].set).toMatchObject({ status: "completed" });
  });

  it("completes the session but skips the payment insert when session.customerId is null", async () => {
    selectResults.push([matchingSession({ customerId: null })]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordPayment(basePaymentEvent);

    expect(insertCalls.find((c) => c.table === "payments")).toBeUndefined();
    expect(updateCalls[0].set).toMatchObject({ status: "completed" });
  });

  it("records an unmatched event when the mint is unrecognized, without throwing", async () => {
    selectResults.push([matchingSession()]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordPayment({ ...basePaymentEvent, mint: "UnknownMint1111111111111111111111111111" });

    const unmatchedInsert = insertCalls.find((c) => c.table === "unmatchedEvents");
    expect(unmatchedInsert).toBeDefined();
    expect(unmatchedInsert!.values).toMatchObject({ eventType: "SolanaPaymentReceivedUnknownMint" });
    expect(insertCalls.find((c) => c.table === "payments")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @paylix/solana-indexer test -- db-callbacks`
Expected: FAIL with "Cannot find module '../db-callbacks'"

- [ ] **Step 4: Write the implementation**

```typescript
// packages/solana-indexer/src/db-callbacks.ts
/**
 * Drizzle-backed implementation of the Solana indexer's WriterCallbacks.
 * Same posture as packages/utxo-indexer/src/db-callbacks.ts: dependency-
 * injected `db` so tests can pass a fake, try/catch around inserts that can
 * legitimately race (duplicate tx delivery), and unmatched_events retention
 * for anything that can't be written (session-matching miss OR unrecognized
 * mint OR unknown subscription) rather than dropping the event.
 */

import { and, desc, eq, or } from "drizzle-orm";
import { keccak256, stringToBytes } from "viem";
import type { Database } from "@paylix/db/client";
import { payments, checkoutSessions, subscriptions, unmatchedEvents } from "@paylix/db/schema";
import type { WriterCallbacks } from "./writer";
import { resolveMint } from "./token-registry";

export interface SolanaDbCallbacksOptions {
  db: Database;
  networkKey: "solana" | "solana-devnet";
}

export function makeSolanaDbCallbacks(opts: SolanaDbCallbacksOptions): WriterCallbacks {
  const { db, networkKey } = opts;
  const livemode = networkKey === "solana";

  async function recordUnmatched(
    eventType: string,
    txHash: string,
    slot: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await db.insert(unmatchedEvents).values({
        eventType,
        txHash,
        blockNumber: slot,
        payload: serializeArgs(payload),
        livemode,
      });
    } catch (err) {
      console.error(`[solana-db-callbacks] failed to record unmatched ${eventType}:`, err);
    }
  }

  async function findMatchingSession(
    customerIdHash: string,
    type: "one_time" | "subscription",
  ) {
    const candidates = await db
      .select()
      .from(checkoutSessions)
      .where(
        and(
          eq(checkoutSessions.networkKey, networkKey),
          eq(checkoutSessions.type, type),
          or(eq(checkoutSessions.status, "active"), eq(checkoutSessions.status, "viewed")),
        ),
      )
      .orderBy(desc(checkoutSessions.createdAt))
      .limit(200);

    return candidates.find(
      (s) => keccak256(stringToBytes(s.id)).toLowerCase() === customerIdHash.toLowerCase(),
    );
  }

  return {
    async recordPayment(ev): Promise<void> {
      const session = await findMatchingSession(ev.customerId, "one_time");
      if (!session) {
        await recordUnmatched("SolanaPaymentReceived", ev.signature, ev.slot, ev);
        return;
      }

      let token;
      try {
        token = resolveMint(networkKey, ev.mint);
      } catch {
        await recordUnmatched("SolanaPaymentReceivedUnknownMint", ev.signature, ev.slot, ev);
        return;
      }

      if (session.customerId) {
        const amountCents = Number(ev.amount) / 10 ** (token.decimals - 2);
        const feeCents = Number(ev.fee) / 10 ** (token.decimals - 2);
        try {
          await db.insert(payments).values({
            productId: session.productId,
            organizationId: session.organizationId,
            customerId: session.customerId,
            amount: amountCents,
            fee: feeCents,
            status: "confirmed",
            txHash: ev.signature,
            chain: networkKey,
            token: token.symbol,
            fromAddress: ev.buyer,
            toAddress: ev.merchant,
            blockNumber: ev.slot,
            livemode: session.livemode,
          });
        } catch (err) {
          // payments_chain_tx_idx unique index rejects duplicates — expected
          // on redelivery of the same signature.
          console.warn(`[solana-db-callbacks] payment insert for ${session.id} failed:`, err);
        }
      }

      await db
        .update(checkoutSessions)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(checkoutSessions.id, session.id));
    },

    async recordSubscriptionCreated(): Promise<void> {
      throw new Error("not implemented"); // Task 3
    },
    async recordSubscriptionCharged(): Promise<void> {
      throw new Error("not implemented"); // Task 4
    },
    async recordSubscriptionCancelled(): Promise<void> {
      throw new Error("not implemented"); // Task 5
    },
  };
}

function serializeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}
```

Note on the `fee: 0.5` assertion in the test: `payments.fee` is declared `integer` in the schema but Drizzle does not coerce at the JS layer before Postgres receives the value — Postgres itself truncates on insert. The mock DB in this test never touches real Postgres, so it will see the raw JS number `0.5`. This is a pre-existing pattern (the EVM handler does the same division without rounding, `packages/indexer/src/handlers.ts:160`) — not a new issue introduced here, so this plan matches it rather than diverging. If this bothers you at review time, flag it as a follow-up for both indexers together, not a blocker for this task.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @paylix/solana-indexer test -- db-callbacks`
Expected: PASS (5 tests). `token-registry` tests from Task 1 still pass too.

- [ ] **Step 6: Commit**

```bash
git add packages/solana-indexer/package.json packages/solana-indexer/src/db-callbacks.ts packages/solana-indexer/src/__tests__/db-callbacks.test.ts pnpm-lock.yaml
git commit -m "feat(solana): wire recordPayment to Postgres"
```

---

## Task 3: `db-callbacks.ts` — `recordSubscriptionCreated`

**Files:**
- Modify: `packages/solana-indexer/src/db-callbacks.ts`
- Modify: `packages/solana-indexer/src/__tests__/db-callbacks.test.ts`

**Interfaces:**
- Consumes: `findMatchingSession`, `recordUnmatched`, `resolveMint` (all defined in Task 2, same file).
- Produces: working `recordSubscriptionCreated` on the object returned by `makeSolanaDbCallbacks`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/solana-indexer/src/__tests__/db-callbacks.test.ts`:

```typescript
import { subscriptions } from "@paylix/db/schema";

// Replace the Task 2 mockDb.insert implementation with this version, which
// also routes the `subscriptions` table:
const mockDbInsertRouter = vi.fn((table: unknown) => {
  const name =
    table === payments
      ? "payments"
      : table === subscriptions
        ? "subscriptions"
        : table === unmatchedEvents
          ? "unmatchedEvents"
          : "checkoutSessions";
  return makeInsertChain(name);
});
mockDb.insert = mockDbInsertRouter;

const baseSubCreatedEvent = {
  signature: "sig_sub_1",
  slot: 200,
  programId: "prog_manager",
  subscriptionId: 42n,
  subscriber: "subscriber_pubkey",
  merchantAta: "merchant_ata",
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: 1_000_000n,
  intervalSeconds: 2_592_000n, // 30 days
  productId: keccak256(stringToBytes("prod_1")),
  customerId: keccak256(stringToBytes(SESSION_ID)),
};

describe("makeSolanaDbCallbacks().recordSubscriptionCreated", () => {
  it("inserts a subscription row and completes the session on a match", async () => {
    selectResults.push([matchingSession({ status: "active" })]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordSubscriptionCreated(baseSubCreatedEvent);

    const subInsert = insertCalls.find((c) => c.table === "subscriptions");
    expect(subInsert).toBeDefined();
    expect(subInsert!.values).toMatchObject({
      productId: "prod_1",
      organizationId: "org_1",
      customerId: CUSTOMER_UUID,
      subscriberAddress: "subscriber_pubkey",
      contractAddress: "prog_manager",
      networkKey: "solana",
      tokenSymbol: "USDC",
      status: "active",
      onChainId: "42",
      intervalSeconds: 2_592_000,
      livemode: false,
    });
    expect(updateCalls[0].set).toMatchObject({ status: "completed" });
  });

  it("records an unmatched event when no session matches", async () => {
    selectResults.push([]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordSubscriptionCreated(baseSubCreatedEvent);

    const unmatchedInsert = insertCalls.find((c) => c.table === "unmatchedEvents");
    expect(unmatchedInsert!.values).toMatchObject({ eventType: "SolanaSubscriptionCreated" });
  });

  it("records an unmatched event when the matched session has no customerId", async () => {
    selectResults.push([matchingSession({ customerId: null })]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordSubscriptionCreated(baseSubCreatedEvent);

    // subscriptions.customerId is NOT NULL — unlike a one-time payment, there
    // is no valid row to write, so this must not silently drop the event.
    const unmatchedInsert = insertCalls.find((c) => c.table === "unmatchedEvents");
    expect(unmatchedInsert!.values).toMatchObject({ eventType: "SolanaSubscriptionCreatedNoCustomer" });
    expect(insertCalls.find((c) => c.table === "subscriptions")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @paylix/solana-indexer test -- db-callbacks`
Expected: FAIL — `recordSubscriptionCreated` throws "not implemented".

- [ ] **Step 3: Implement `recordSubscriptionCreated`**

In `packages/solana-indexer/src/db-callbacks.ts`, replace the stub:

```typescript
    async recordSubscriptionCreated(ev): Promise<void> {
      const session = await findMatchingSession(ev.customerId, "subscription");
      if (!session) {
        await recordUnmatched("SolanaSubscriptionCreated", ev.signature, ev.slot, ev);
        return;
      }

      if (!session.customerId) {
        // subscriptions.customerId is NOT NULL — unlike recordPayment, there
        // is no valid row to write without one. Retain for investigation
        // rather than silently dropping.
        await recordUnmatched("SolanaSubscriptionCreatedNoCustomer", ev.signature, ev.slot, ev);
        return;
      }

      let token;
      try {
        token = resolveMint(networkKey, ev.mint);
      } catch {
        await recordUnmatched("SolanaSubscriptionCreatedUnknownMint", ev.signature, ev.slot, ev);
        return;
      }

      const intervalSeconds = Number(ev.intervalSeconds);
      const now = new Date();
      const nextChargeDate = new Date(now.getTime() + intervalSeconds * 1000);

      await db.insert(subscriptions).values({
        productId: session.productId,
        organizationId: session.organizationId,
        customerId: session.customerId,
        subscriberAddress: ev.subscriber,
        contractAddress: ev.programId,
        networkKey,
        tokenSymbol: token.symbol,
        status: "active",
        onChainId: ev.subscriptionId.toString(),
        intervalSeconds,
        currentPeriodStart: now,
        nextChargeDate,
        livemode: session.livemode,
      });

      await db
        .update(checkoutSessions)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(checkoutSessions.id, session.id));
    },
```

Also update the `insert` mock router in the test file to route the `subscriptions` table (see Step 1 note).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paylix/solana-indexer test -- db-callbacks`
Expected: PASS (8 tests: 5 from Task 2 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/solana-indexer/src/db-callbacks.ts packages/solana-indexer/src/__tests__/db-callbacks.test.ts
git commit -m "feat(solana): wire recordSubscriptionCreated to Postgres"
```

---

## Task 4: `db-callbacks.ts` — `recordSubscriptionCharged`

**Files:**
- Modify: `packages/solana-indexer/src/db-callbacks.ts`
- Modify: `packages/solana-indexer/src/__tests__/db-callbacks.test.ts`

**Interfaces:**
- Consumes: `resolveMint`, `recordUnmatched` from Task 2/3 (same file).
- Produces: working `recordSubscriptionCharged`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/solana-indexer/src/__tests__/db-callbacks.test.ts`:

```typescript
function matchingSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sub_row_1",
    productId: "prod_1",
    organizationId: "org_1",
    customerId: CUSTOMER_UUID,
    contractAddress: "prog_manager",
    onChainId: "42",
    intervalSeconds: 2_592_000,
    tokenSymbol: "USDC",
    networkKey: "solana",
    livemode: false,
    ...overrides,
  };
}

const baseSubChargedEvent = {
  signature: "sig_charge_1",
  slot: 300,
  programId: "prog_manager",
  subscriptionId: 42n,
  subscriber: "subscriber_pubkey",
  merchantAta: "merchant_ata",
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: 1_000_000n,
};

describe("makeSolanaDbCallbacks().recordSubscriptionCharged", () => {
  it("inserts a payment row and advances the subscription on a match", async () => {
    selectResults.push([matchingSubscription()]); // subscription lookup

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordSubscriptionCharged(baseSubChargedEvent);

    const paymentInsert = insertCalls.find((c) => c.table === "payments");
    expect(paymentInsert!.values).toMatchObject({
      productId: "prod_1",
      organizationId: "org_1",
      customerId: CUSTOMER_UUID,
      amount: 100,
      status: "confirmed",
      txHash: "sig_charge_1",
      chain: "solana",
      token: "USDC",
    });
    expect(updateCalls[0].set.nextChargeDate).toBeInstanceOf(Date);
    expect(updateCalls[0].set).toMatchObject({ pastDueSince: null, chargeFailureCount: 0 });
  });

  it("records an unmatched event when no subscription matches", async () => {
    selectResults.push([]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordSubscriptionCharged(baseSubChargedEvent);

    const unmatchedInsert = insertCalls.find((c) => c.table === "unmatchedEvents");
    expect(unmatchedInsert!.values).toMatchObject({ eventType: "SolanaSubscriptionCharged" });
    expect(insertCalls.find((c) => c.table === "payments")).toBeUndefined();
  });

  it("does not throw on a duplicate charge signature", async () => {
    selectResults.push([matchingSubscription()]);
    insertResults.push(new Error("duplicate key value violates unique constraint \"payments_chain_tx_idx\""));

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await expect(callbacks.recordSubscriptionCharged(baseSubChargedEvent)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @paylix/solana-indexer test -- db-callbacks`
Expected: FAIL — `recordSubscriptionCharged` throws "not implemented".

- [ ] **Step 3: Implement `recordSubscriptionCharged`**

```typescript
    async recordSubscriptionCharged(ev): Promise<void> {
      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.contractAddress, ev.programId),
            eq(subscriptions.onChainId, ev.subscriptionId.toString()),
          ),
        )
        .limit(1);

      if (!subscription) {
        // Could be a race with recordSubscriptionCreated on the same slot.
        await recordUnmatched("SolanaSubscriptionCharged", ev.signature, ev.slot, ev);
        return;
      }

      let token;
      try {
        token = resolveMint(networkKey, ev.mint);
      } catch {
        await recordUnmatched("SolanaSubscriptionChargedUnknownMint", ev.signature, ev.slot, ev);
        return;
      }

      const amountCents = Number(ev.amount) / 10 ** (token.decimals - 2);

      try {
        await db.insert(payments).values({
          productId: subscription.productId,
          organizationId: subscription.organizationId,
          customerId: subscription.customerId,
          amount: amountCents,
          fee: 0,
          status: "confirmed",
          txHash: ev.signature,
          chain: networkKey,
          token: token.symbol,
          fromAddress: ev.subscriber,
          toAddress: ev.merchantAta,
          blockNumber: ev.slot,
          livemode: subscription.livemode,
        });
      } catch (err) {
        console.warn(`[solana-db-callbacks] recurring payment insert for sub ${subscription.id} failed:`, err);
        return;
      }

      const intervalMs = (subscription.intervalSeconds ?? 0) * 1000;
      const now = new Date();
      await db
        .update(subscriptions)
        .set({
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + intervalMs),
          nextChargeDate: new Date(now.getTime() + intervalMs),
          pastDueSince: null,
          chargeFailureCount: 0,
        })
        .where(eq(subscriptions.id, subscription.id));
    },
```

Note: on a duplicate-signature race, the `catch` block returns *before* updating the subscription period — this matches the third test's intent (no throw) while avoiding double-advancing `nextChargeDate` for the same charge event delivered twice.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paylix/solana-indexer test -- db-callbacks`
Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/solana-indexer/src/db-callbacks.ts packages/solana-indexer/src/__tests__/db-callbacks.test.ts
git commit -m "feat(solana): wire recordSubscriptionCharged to Postgres"
```

---

## Task 5: `db-callbacks.ts` — `recordSubscriptionCancelled`

**Files:**
- Modify: `packages/solana-indexer/src/db-callbacks.ts`
- Modify: `packages/solana-indexer/src/__tests__/db-callbacks.test.ts`

**Interfaces:**
- Produces: working `recordSubscriptionCancelled` — the last stub, so `makeSolanaDbCallbacks` fully satisfies `WriterCallbacks` after this task.

- [ ] **Step 1: Write the failing tests**

```typescript
const baseSubCancelledEvent = {
  signature: "sig_cancel_1",
  slot: 400,
  programId: "prog_manager",
  subscriptionId: 42n,
};

describe("makeSolanaDbCallbacks().recordSubscriptionCancelled", () => {
  it("flips the subscription to cancelled on a match", async () => {
    selectResults.push([matchingSubscription()]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordSubscriptionCancelled(baseSubCancelledEvent);

    expect(updateCalls[0].set).toMatchObject({ status: "cancelled" });
  });

  it("records an unmatched event when no subscription matches", async () => {
    selectResults.push([]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordSubscriptionCancelled(baseSubCancelledEvent);

    const unmatchedInsert = insertCalls.find((c) => c.table === "unmatchedEvents");
    expect(unmatchedInsert!.values).toMatchObject({ eventType: "SolanaSubscriptionCancelled" });
  });

  it("is idempotent on redelivery — re-cancelling an already-cancelled subscription does not throw", async () => {
    selectResults.push([matchingSubscription({ status: "cancelled" })]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await expect(callbacks.recordSubscriptionCancelled(baseSubCancelledEvent)).resolves.not.toThrow();
    expect(updateCalls[0].set).toMatchObject({ status: "cancelled" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @paylix/solana-indexer test -- db-callbacks`
Expected: FAIL — `recordSubscriptionCancelled` throws "not implemented".

- [ ] **Step 3: Implement `recordSubscriptionCancelled`**

```typescript
    async recordSubscriptionCancelled(ev): Promise<void> {
      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.contractAddress, ev.programId),
            eq(subscriptions.onChainId, ev.subscriptionId.toString()),
          ),
        )
        .limit(1);

      if (!subscription) {
        await recordUnmatched("SolanaSubscriptionCancelled", ev.signature, ev.slot, ev);
        return;
      }

      await db
        .update(subscriptions)
        .set({ status: "cancelled" })
        .where(eq(subscriptions.id, subscription.id));
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paylix/solana-indexer test -- db-callbacks`
Expected: PASS (14 tests total).

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @paylix/solana-indexer exec tsc --noEmit`
Expected: no errors. (`makeSolanaDbCallbacks` now returns a complete `WriterCallbacks` with no `throw new Error("not implemented")` stubs left — if this doesn't typecheck clean, a method signature drifted from `writer.ts`.)

- [ ] **Step 6: Commit**

```bash
git add packages/solana-indexer/src/db-callbacks.ts packages/solana-indexer/src/__tests__/db-callbacks.test.ts
git commit -m "feat(solana): wire recordSubscriptionCancelled to Postgres"
```

---

## Task 6: Wire `index.ts` to the real writer

**Files:**
- Modify: `packages/solana-indexer/src/index.ts:1-74`

**Interfaces:**
- Consumes: `makeSolanaDbCallbacks` (Task 2-5), `makeEventHandler` (`packages/solana-indexer/src/writer.ts:63-78`, already exists), `createDb` from `@paylix/db/client`.

- [ ] **Step 1: Edit `index.ts`**

Current stub (`packages/solana-indexer/src/index.ts:1-74`):

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import { startListener } from "./listener";
import { startKeeper } from "./keeper";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}

async function main(): Promise<void> {
  const rpcUrl = requireEnv("SOLANA_RPC_URL");
  const commitment =
    (process.env.SOLANA_COMMITMENT as "finalized" | "confirmed" | undefined) ??
    "finalized";
  const connection = new Connection(rpcUrl, commitment);

  const programIds: PublicKey[] = [];
  const vaultId = process.env.SOLANA_PAYMENT_VAULT_PROGRAM_ID;
  if (vaultId) programIds.push(new PublicKey(vaultId));
  const mgrId = process.env.SOLANA_SUBSCRIPTION_MANAGER_PROGRAM_ID;
  if (mgrId) programIds.push(new PublicKey(mgrId));
  if (programIds.length === 0) {
    throw new Error(
      "At least one of SOLANA_PAYMENT_VAULT_PROGRAM_ID / SOLANA_SUBSCRIPTION_MANAGER_PROGRAM_ID must be set.",
    );
  }

  const listener = await startListener({
    connection,
    programIds,
    commitment,
    onEvent: async (ev) => {
      // Hook point for the DB writer — real integration in the #57 follow-up
      // PR that adds Postgres bindings for Solana network_key tables.
      console.log(`[solana-listener] ${ev.kind} at slot ${ev.slot} sig=${ev.signature}`);
    },
  });

  const keeper = await startKeeper({
    connection,
    // Full wiring (keeper keypair load, due-subscription query) needs the
    // DB bindings above. Running in skeleton mode here lets the service
    // boot cleanly until that lands.
  });
```

Replace with:

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import { createDb } from "@paylix/db/client";
import { startListener } from "./listener";
import { startKeeper } from "./keeper";
import { makeSolanaDbCallbacks } from "./db-callbacks";
import { makeEventHandler } from "./writer";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}

function requireNetworkKey(): "solana" | "solana-devnet" {
  const v = requireEnv("SOLANA_NETWORK_KEY");
  if (v !== "solana" && v !== "solana-devnet") {
    throw new Error(`SOLANA_NETWORK_KEY must be "solana" or "solana-devnet", got "${v}"`);
  }
  return v;
}

async function main(): Promise<void> {
  const rpcUrl = requireEnv("SOLANA_RPC_URL");
  const networkKey = requireNetworkKey();
  const commitment =
    (process.env.SOLANA_COMMITMENT as "finalized" | "confirmed" | undefined) ??
    "finalized";
  const connection = new Connection(rpcUrl, commitment);

  const programIds: PublicKey[] = [];
  const vaultId = process.env.SOLANA_PAYMENT_VAULT_PROGRAM_ID;
  if (vaultId) programIds.push(new PublicKey(vaultId));
  const mgrId = process.env.SOLANA_SUBSCRIPTION_MANAGER_PROGRAM_ID;
  if (mgrId) programIds.push(new PublicKey(mgrId));
  if (programIds.length === 0) {
    throw new Error(
      "At least one of SOLANA_PAYMENT_VAULT_PROGRAM_ID / SOLANA_SUBSCRIPTION_MANAGER_PROGRAM_ID must be set.",
    );
  }

  console.log(`[solana-indexer] starting on network_key=${networkKey} rpc=${rpcUrl}`);
  const db = createDb(requireEnv("DATABASE_URL"));
  const dbCallbacks = makeSolanaDbCallbacks({ db, networkKey });
  const onEvent = makeEventHandler(dbCallbacks);

  const listener = await startListener({
    connection,
    programIds,
    commitment,
    onEvent: async (ev) => {
      console.log(`[solana-listener] ${ev.kind} at slot ${ev.slot} sig=${ev.signature}`);
      await onEvent(ev);
    },
  });

  const keeper = await startKeeper({
    connection,
    // Keeper charging (keypair load + due-subscription query) is a separate
    // follow-up — see docs/superpowers/specs/2026-07-11-solana-indexer-db-writer-design.md.
    // Listener-side DB wiring above is complete; this is the keeper's own gap.
  });
```

The rest of `main()` (shutdown handler, `process.on` registration, the `void main().catch(...)` footer) is unchanged.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @paylix/solana-indexer exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full package test suite**

Run: `pnpm --filter @paylix/solana-indexer test`
Expected: PASS — all tests from Tasks 1-5 plus the existing `decoder.test.ts` / `lifecycle.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/solana-indexer/src/index.ts
git commit -m "feat(solana): wire listener to Postgres writer, add SOLANA_NETWORK_KEY"
```

---

## Final Verification

- [ ] Run `pnpm --filter @paylix/solana-indexer test` — all tests pass.
- [ ] Run `pnpm --filter @paylix/solana-indexer exec tsc --noEmit` — no type errors.
- [ ] Run `pnpm lint` from repo root — no new lint errors introduced.
- [ ] Grep the package for the string `"not implemented"` — should return zero matches (confirms no stub was left behind).
- [ ] Manually re-read `packages/solana-indexer/src/index.ts` end to end — confirm the keeper's remaining skeleton-mode comment accurately describes what's still missing (keypair + due-subscription query), not what this plan already wired.
