import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock config BEFORE importing handlers ---
vi.mock("../config", () => ({
  config: {
    networkKey: "base-sepolia",
    chain: { id: 84532 },
    environment: "testnet",
    rpcUrl: "http://test",
    databaseUrl: "postgres://test",
    paymentVaultAddress: "0xvault" as `0x${string}`,
    subscriptionManagerAddress: "0xCONTRACT" as `0x${string}`,
    keeperPrivateKey: "0x00" as `0x${string}`,
    relayerPrivateKey: undefined,
    keeperIntervalMinutes: 60,
    publicAppUrl: "http://localhost:3000",
    defaultFromEmail: "test@test",
  },
}));

// --- Mock webhook dispatch ---
const dispatchWebhooks = vi.fn(async (..._args: unknown[]) => {});
vi.mock("../webhook-dispatch", () => ({
  dispatchWebhooks: (...a: unknown[]) => dispatchWebhooks(...a),
}));

// --- Mock db client ---
// Drizzle's fluent query builder is chainable. Every intermediate call returns
// `this`, and the terminal call is awaited. We use a thenable object so `await`
// on any stage resolves to the queued result.
type QueryResult = unknown[];

const selectResults: QueryResult[] = [];
const updateCalls: Array<{ set: Record<string, unknown> }> = [];
const insertCalls: Array<{ values: unknown }> = [];
const transactionFn = vi.fn();

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "where", "orderBy", "limit", "innerJoin", "leftJoin", "groupBy"];
  for (const m of methods) chain[m] = () => chain;
  (chain as { then: (r: (v: QueryResult) => void) => void }).then = (resolve) => {
    const next = selectResults.shift() ?? [];
    resolve(next);
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
    returning: () => chain,
  };
  (chain as { then: (r: (v: QueryResult) => void) => void }).then = (resolve) => {
    updateCalls.push(captured);
    resolve([]);
  };
  return chain;
}

function makeInsertChain() {
  const captured: { values: unknown } = { values: null };
  const chain: Record<string, unknown> = {
    values: (v: unknown) => {
      captured.values = v;
      return chain;
    },
    onConflictDoNothing: () => chain,
    onConflictDoUpdate: () => chain,
    returning: () => chain,
  };
  (chain as { then: (r: (v: QueryResult) => void) => void }).then = (resolve) => {
    insertCalls.push(captured);
    resolve([]);
  };
  return chain;
}

const mockDb = {
  select: vi.fn(() => makeSelectChain()),
  update: vi.fn(() => makeUpdateChain()),
  insert: vi.fn(() => makeInsertChain()),
  transaction: transactionFn,
};

vi.mock("@paylix/db/client", () => ({
  createDb: () => mockDb,
}));

// Now import the handler under test. Must be after mocks.
const { handleSubscriptionCreated } = await import("../handlers");

const TRIAL_ROW = {
  id: "sub_trial_1",
  organizationId: "org_1",
  subscriberAddress: "0xBuyer",
  contractAddress: "0xcontract",
  status: "trialing",
  pendingPermitSignature: {
    intent: { amount: "1000000", interval: 2592000 },
  },
};

const baseLog = {
  transactionHash: "0xtx" as `0x${string}`,
  blockNumber: 1n,
  logIndex: 0,
} as unknown as Parameters<typeof handleSubscriptionCreated>[0];

const baseArgs = {
  subscriptionId: 42n,
  subscriber: "0xbuyer" as `0x${string}`,
  merchant: "0xmerchant" as `0x${string}`,
  token: "0xusdc" as `0x${string}`,
  amount: 1000000n,
  interval: 2592000n,
  productId: ("0x" + "11".repeat(32)) as `0x${string}`,
  customerId: ("0x" + "22".repeat(32)) as `0x${string}`,
};

describe("handleSubscriptionCreated trial activation", () => {
  beforeEach(() => {
    selectResults.length = 0;
    updateCalls.length = 0;
    insertCalls.length = 0;
    mockDb.select.mockClear();
    mockDb.update.mockClear();
    mockDb.insert.mockClear();
    dispatchWebhooks.mockClear();
  });

  it("activates an existing trialing row instead of inserting a duplicate", async () => {
    // 1st select: idempotency check -> empty (no existing onChainId row)
    selectResults.push([]);
    // 2nd select: trial-match query -> returns the trialing row
    selectResults.push([TRIAL_ROW]);

    await handleSubscriptionCreated(baseLog, baseArgs);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toMatchObject({
      status: "active",
      onChainId: "42",
      pendingPermitSignature: null,
      trialConversionLastError: null,
      intervalSeconds: 2592000,
    });
    expect(updateCalls[0].set.currentPeriodStart).toBeInstanceOf(Date);
    expect(updateCalls[0].set.currentPeriodEnd).toBeInstanceOf(Date);
    expect(updateCalls[0].set.nextChargeDate).toBeInstanceOf(Date);

    // No duplicate subscription insert should have been issued.
    expect(mockDb.insert).not.toHaveBeenCalled();

    // trial_converted webhook dispatched.
    expect(dispatchWebhooks).toHaveBeenCalledWith(
      "org_1",
      "subscription.trial_converted",
      expect.objectContaining({
        subscriptionId: "sub_trial_1",
        onChainId: "42",
      }),
    );
  });

  it("falls through to the checkout-session flow when no trialing row matches", async () => {
    // 1st select: idempotency check -> empty
    selectResults.push([]);
    // 2nd select: trial-match query -> empty (no trial row)
    selectResults.push([]);

    // The real handler then calls symbolForTokenAddress() which throws for
    // our fake "0xusdc" token — which is fine. We only care that control
    // flowed PAST the trial-match block. The throw itself proves fall-through.
    await expect(handleSubscriptionCreated(baseLog, baseArgs)).rejects.toThrow(
      /not registered/,
    );

    // The early-return trial path did NOT fire: no update was issued.
    expect(updateCalls).toHaveLength(0);
    // And no trial_converted webhook either.
    expect(dispatchWebhooks).not.toHaveBeenCalledWith(
      expect.anything(),
      "subscription.trial_converted",
      expect.anything(),
    );
    // Two selects ran (idempotency + trial-match) before the throw.
    expect(mockDb.select.mock.calls.length).toBe(2);
  });
});
