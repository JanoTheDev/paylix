import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { makeSolanaKeeperCallbacks } from "../keeper-callbacks";
import * as subscriptionAccount from "../subscription-account";

type QueryResult = unknown[];

const selectResults: QueryResult[] = [];
const updateCalls: Array<{ set: Record<string, unknown> }> = [];

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "where", "limit", "orderBy"];
  for (const m of methods) chain[m] = () => chain;
  // biome-ignore lint/suspicious/noThenProperty: deliberate thenable mock for chainable query builder
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
  // biome-ignore lint/suspicious/noThenProperty: deliberate thenable mock for chainable query builder
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
    vi.spyOn(subscriptionAccount, "fetchSubscriptionAccounts").mockResolvedValue([{
      id: 42n,
      subscriber: SUBSCRIBER.toBase58(),
      merchantAta: MERCHANT_ATA.toBase58(),
      mint: MINT.toBase58(),
      amount: 1_000_000n,
      intervalSeconds: 2_592_000n,
      nextChargeAt: 0n, // long past due
      status: 0, // Active
    }]);

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
    vi.spyOn(subscriptionAccount, "fetchSubscriptionAccounts").mockResolvedValue([{
      id: 42n,
      subscriber: SUBSCRIBER.toBase58(),
      merchantAta: MERCHANT_ATA.toBase58(),
      mint: MINT.toBase58(),
      amount: 1_000_000n,
      intervalSeconds: 2_592_000n,
      nextChargeAt: 0n,
      status: 2, // Cancelled
    }]);

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
    vi.spyOn(subscriptionAccount, "fetchSubscriptionAccounts").mockResolvedValue([null]);

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
    vi.spyOn(subscriptionAccount, "fetchSubscriptionAccounts").mockResolvedValue([]);

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
  it("stamps lastChargeAttemptAt and resets the dunning counters", async () => {
    const callbacks = makeSolanaKeeperCallbacks({
      db: mockDb as never,
      connection: {} as Connection,
      networkKey: "solana",
      platformWallet: PLATFORM_WALLET,
    });
    await callbacks.onChargeSubmitted(42n);

    expect(updateCalls[0].set.lastChargeAttemptAt).toBeInstanceOf(Date);
    expect(updateCalls[0].set).toMatchObject({
      chargeFailureCount: 0,
      lastChargeError: null,
      pastDueSince: null,
    });
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
