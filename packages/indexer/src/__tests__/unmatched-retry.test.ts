import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks must be installed before importing handlers ---
vi.mock("@paylix/config/networks", () => ({
  NETWORKS: {
    "base-sepolia": { tokens: { USDC: { address: "0xusdc", decimals: 6 } } },
  },
  getToken: () => ({ decimals: 6, address: "0xusdc", symbol: "USDC" }),
}));

vi.mock("../config", () => ({
  config: {
    databaseUrl: "postgres://test",
    keeperPrivateKey: "0x00" as `0x${string}`,
    relayerPrivateKey: undefined,
    keeperIntervalMinutes: 60,
    publicAppUrl: "http://localhost:3000",
    defaultFromEmail: "test@test",
  },
}));

vi.mock("../invoices/create", () => ({ buildInvoice: () => ({}) }));
vi.mock("../invoices/send-email", () => ({ sendInvoiceEmail: vi.fn(async () => {}) }));
const dispatchSystemWebhook = vi.fn(async () => {});
vi.mock("../webhook-dispatch", () => ({
  dispatchWebhooks: vi.fn(async () => {}),
  dispatchSystemWebhook: (...a: unknown[]) => dispatchSystemWebhook(...(a as [])),
}));

// --- Chainable drizzle mock ---
type QueuedResult = unknown[] | Error;

const selectResults: QueuedResult[] = [];
const updateCalls: Array<{ set: Record<string, unknown> }> = [];
const insertCalls: Array<{ values: unknown }> = [];
const deleteCalls: number[] = [];

function thenable(chain: Record<string, unknown>, resolveWith: () => QueuedResult) {
  // biome-ignore lint/suspicious/noThenProperty: deliberate thenable query-builder mock
  (chain as {
    then: (res: (v: unknown[]) => void, rej: (e: unknown) => void) => void;
  }).then = (resolve, reject) => {
    const next = resolveWith();
    if (next instanceof Error) reject(next);
    else resolve(next);
  };
  return chain;
}

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "offset", "innerJoin"]) {
    chain[m] = () => chain;
  }
  return thenable(chain, () => selectResults.shift() ?? []);
}

function makeUpdateChain() {
  const captured = { set: {} as Record<string, unknown> };
  const chain: Record<string, unknown> = {
    set: (v: Record<string, unknown>) => {
      captured.set = v;
      return chain;
    },
    where: () => chain,
    returning: () => chain,
  };
  return thenable(chain, () => {
    updateCalls.push(captured);
    return [];
  });
}

function makeInsertChain() {
  const captured = { values: null as unknown };
  const chain: Record<string, unknown> = {
    values: (v: unknown) => {
      captured.values = v;
      return chain;
    },
    onConflictDoNothing: () => chain,
    onConflictDoUpdate: () => chain,
    returning: () => chain,
  };
  return thenable(chain, () => {
    insertCalls.push(captured);
    return [];
  });
}

function makeDeleteChain() {
  const chain: Record<string, unknown> = { where: () => chain };
  return thenable(chain, () => {
    deleteCalls.push(1);
    return [];
  });
}

const mockDb = {
  select: vi.fn(() => makeSelectChain()),
  update: vi.fn(() => makeUpdateChain()),
  insert: vi.fn(() => makeInsertChain()),
  delete: vi.fn(() => makeDeleteChain()),
  transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockDb)),
};

vi.mock("@paylix/db/client", () => ({ createDb: () => mockDb }));

const { retryUnmatchedEvents, MAX_UNMATCHED_ATTEMPTS } = await import("../handlers");

const CTX = {
  livemode: false,
  networkKey: "base-sepolia",
  paymentVault: "0x0000000000000000000000000000000000000001",
  subscriptionManager: "0x0000000000000000000000000000000000000002",
};

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "unmatched_1",
    eventType: "PaymentReceived",
    txHash: "0xdeadbeef",
    blockNumber: 100,
    logIndex: 0,
    attempts: 0,
    livemode: false,
    createdAt: new Date("2026-07-31T00:00:00Z"),
    payload: {
      payer: "0xpayer",
      merchant: "0xmerchant",
      token: "0xusdc",
      amount: "1000000",
      fee: "5000",
      productId: `0x${"11".repeat(32)}`,
      customerId: `0x${"22".repeat(32)}`,
      timestamp: "1700000000",
      _ctx: CTX,
    },
    ...overrides,
  };
}

describe("retryUnmatchedEvents", () => {
  beforeEach(() => {
    selectResults.length = 0;
    updateCalls.length = 0;
    insertCalls.length = 0;
    deleteCalls.length = 0;
    mockDb.select.mockClear();
    mockDb.delete.mockClear();
    dispatchSystemWebhook.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("deletes the retained row only AFTER the handler succeeds", async () => {
    selectResults.push([{ count: 1 }]); // queue depth
    selectResults.push([paymentRow()]); // rows to retry
    selectResults.push([{ id: "pay_1" }]); // handler: payment already exists -> processed

    await retryUnmatchedEvents();

    expect(updateCalls[0].set).toMatchObject({ attempts: 1 });
    expect(deleteCalls).toHaveLength(1);
  });

  it("keeps the row when the handler throws", async () => {
    // The defect this covers: the row used to be deleted BEFORE the replay, so
    // any throw — DB error, unregistered token, missing product — dropped a
    // confirmed on-chain event permanently.
    selectResults.push([{ count: 1 }]);
    selectResults.push([paymentRow()]);
    selectResults.push(new Error("connection terminated"));

    await retryUnmatchedEvents();

    expect(deleteCalls).toHaveLength(0);
    expect(updateCalls[0].set).toMatchObject({ attempts: 1 });
  });

  it("keeps the row (and does not duplicate it) when the event still has no match", async () => {
    selectResults.push([{ count: 1 }]);
    selectResults.push([paymentRow()]);
    selectResults.push([]); // no existing payment
    selectResults.push([]); // session candidate page -> no match

    await retryUnmatchedEvents();

    expect(deleteCalls).toHaveLength(0);
    // The in-flight row is reused instead of inserting a second unmatched row.
    expect(insertCalls).toHaveLength(0);
  });

  it("bumps attempts before replaying so a hopeless event converges on the ceiling", async () => {
    selectResults.push([{ count: 1 }]);
    selectResults.push([paymentRow({ attempts: 7 })]);
    selectResults.push([]);
    selectResults.push([]);

    await retryUnmatchedEvents();

    expect(updateCalls[0].set).toMatchObject({ attempts: 8 });
  });

  it("alerts instead of silently dropping the row that crosses the attempt ceiling", async () => {
    selectResults.push([{ count: 1 }]);
    selectResults.push([paymentRow({ attempts: MAX_UNMATCHED_ATTEMPTS - 1 })]);
    selectResults.push([]);
    selectResults.push([]);

    await retryUnmatchedEvents();

    expect(dispatchSystemWebhook).toHaveBeenCalledWith(
      "system.unmatched_event_abandoned",
      expect.objectContaining({ txHash: "0xdeadbeef", eventType: "PaymentReceived" }),
    );
  });

  it("does not alert when the final attempt succeeds", async () => {
    selectResults.push([{ count: 1 }]);
    selectResults.push([paymentRow({ attempts: MAX_UNMATCHED_ATTEMPTS - 1 })]);
    selectResults.push([{ id: "pay_1" }]); // processed

    await retryUnmatchedEvents();

    expect(deleteCalls).toHaveLength(1);
    expect(dispatchSystemWebhook).not.toHaveBeenCalled();
  });

  it("leaves rows with an unknown event type retained", async () => {
    selectResults.push([{ count: 1 }]);
    selectResults.push([paymentRow({ eventType: "SomethingElse" })]);

    await retryUnmatchedEvents();

    expect(deleteCalls).toHaveLength(0);
    expect(updateCalls[0].set).toMatchObject({ attempts: 1 });
  });

  it("leaves rows with no stored ctx retained", async () => {
    const row = paymentRow();
    row.payload = { ...row.payload, _ctx: undefined } as never;
    selectResults.push([{ count: 1 }]);
    selectResults.push([row]);

    await retryUnmatchedEvents();

    expect(deleteCalls).toHaveLength(0);
  });
});
