import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkoutSessions,
  customers,
  payments,
  unmatchedEvents,
  webhooks,
  webhookDeliveries,
} from "@paylix/db/schema";
import { runRateBackfill } from "../rate-backfill";

type QueryResult = unknown[];

function tableName(t: unknown): string {
  if (t === payments) return "payments";
  if (t === checkoutSessions) return "checkoutSessions";
  if (t === customers) return "customers";
  if (t === unmatchedEvents) return "unmatchedEvents";
  if (t === webhooks) return "webhooks";
  if (t === webhookDeliveries) return "webhookDeliveries";
  return "unknown";
}

const selectQueues: Record<string, QueryResult[]> = {};
const insertQueues: Record<string, Array<QueryResult | Error>> = {};
const writeLog: Array<{ op: "insert" | "update" | "delete"; table: string; values?: unknown }> = [];

function queueSelect(table: string, rows: QueryResult): void {
  const queue = selectQueues[table];
  if (queue) {
    queue.push(rows);
    return;
  }
  selectQueues[table] = [rows];
}
function queueInsert(table: string, result: QueryResult | Error): void {
  const queue = insertQueues[table];
  if (queue) {
    queue.push(result);
    return;
  }
  insertQueues[table] = [result];
}

function makeSelectChain() {
  let table = "unknown";
  const chain: Record<string, unknown> = {
    from: (t: unknown) => {
      table = tableName(t);
      return chain;
    },
  };
  for (const m of ["where", "orderBy", "limit", "offset", "innerJoin"]) {
    chain[m] = () => chain;
  }
  // biome-ignore lint/suspicious/noThenProperty: deliberate thenable mock for chainable query builder
  (chain as { then: (resolve: (v: QueryResult) => void) => void }).then = (resolve) => {
    resolve(selectQueues[table]?.shift() ?? []);
  };
  return chain;
}

function makeUpdateChain(table: string) {
  const captured: { values?: unknown } = {};
  const chain: Record<string, unknown> = {
    set: (v: Record<string, unknown>) => {
      captured.values = v;
      return chain;
    },
    where: () => chain,
  };
  // biome-ignore lint/suspicious/noThenProperty: deliberate thenable mock for chainable query builder
  (chain as { then: (resolve: (v: QueryResult) => void) => void }).then = (resolve) => {
    writeLog.push({ op: "update", table, values: captured.values });
    resolve([]);
  };
  return chain;
}

function makeDeleteChain(table: string) {
  const chain: Record<string, unknown> = { where: () => chain };
  // biome-ignore lint/suspicious/noThenProperty: deliberate thenable mock for chainable query builder
  (chain as { then: (resolve: (v: QueryResult) => void) => void }).then = (resolve) => {
    writeLog.push({ op: "delete", table });
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
    onConflictDoNothing: () => chain,
    returning: () => chain,
  };
  // biome-ignore lint/suspicious/noThenProperty: deliberate thenable mock for chainable query builder
  (chain as {
    then: (resolve: (v: QueryResult) => void, reject: (e: unknown) => void) => void;
  }).then = (resolve, reject) => {
    writeLog.push({ op: "insert", table, values: captured.values });
    const next = insertQueues[table]?.shift() ?? [];
    if (next instanceof Error) reject(next);
    else resolve(next);
  };
  return chain;
}

const mockDb = {
  select: vi.fn(() => makeSelectChain()),
  update: vi.fn((t: unknown) => makeUpdateChain(tableName(t))),
  insert: vi.fn((t: unknown) => makeInsertChain(tableName(t))),
  delete: vi.fn((t: unknown) => makeDeleteChain(tableName(t))),
};

const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";
const CUSTOMER_UUID = "660e8400-e29b-41d4-a716-446655440000";
const PAYMENT_UUID = "770e8400-e29b-41d4-a716-446655440000";
const BTC_RATE_CENTS = 6_000_000; // $60,000 per BTC

function retainedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "unmatched_1",
    eventType: "UtxoPaymentReceivedNoFiatRate",
    txHash: "tx-1",
    blockNumber: 900,
    attempts: 50, // already burned past the EVM sweep's ceiling
    livemode: false,
    createdAt: new Date("2026-07-31T00:00:00Z"),
    payload: {
      sessionId: SESSION_ID,
      chain: "bitcoin",
      receivedSats: "100000",
      expectedSats: "100000",
      vout: 0,
    },
    ...overrides,
  };
}

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    organizationId: "org_1",
    productId: "prod_1",
    customerId: null,
    amount: 100_000n,
    tokenSymbol: "BTC",
    btcReceiveAddress: "bc1qsession",
    fiatRateCents: BTC_RATE_CENTS,
    fiatRateCapturedAt: new Date("2026-07-31T00:00:00Z"),
    livemode: false,
    ...overrides,
  };
}

beforeEach(() => {
  for (const k of Object.keys(selectQueues)) delete selectQueues[k];
  for (const k of Object.keys(insertQueues)) delete insertQueues[k];
  writeLog.length = 0;
  mockDb.select.mockClear();
  mockDb.update.mockClear();
  mockDb.insert.mockClear();
  mockDb.delete.mockClear();
});

function run() {
  return runRateBackfill({ db: mockDb as never, networkKey: "bitcoin" });
}

describe("runRateBackfill", () => {
  it("settles a retained payment once the session has a rate, and clears the row", async () => {
    queueSelect("unmatchedEvents", [retainedRow()]);
    queueSelect("checkoutSessions", [sessionRow()]);
    queueSelect("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    const result = await run();

    expect(result).toMatchObject({ examined: 1, settled: 1, pending: 0, failed: 0 });
    const insert = writeLog.find((w) => w.op === "insert" && w.table === "payments");
    expect(insert!.values).toMatchObject({
      amount: 6_000, // $60.00 from the now-known rate
      amountSats: 100_000n,
      fiatRateCents: BTC_RATE_CENTS,
      txHash: "tx-1",
      status: "confirmed",
    });
    // Session completed, then the retention row removed.
    const ops = writeLog.map((w) => `${w.op}:${w.table}`);
    expect(ops.indexOf("update:checkoutSessions")).toBeGreaterThan(
      ops.indexOf("insert:payments"),
    );
    expect(ops.indexOf("delete:unmatchedEvents")).toBeGreaterThan(
      ops.indexOf("update:checkoutSessions"),
    );
  });

  it("settles a row regardless of how high its attempts counter has climbed", async () => {
    // The EVM sweep bumps `attempts` on rows it declines, so these rows sail
    // past its lt(attempts, 50) filter. This drain must not care about the
    // counter. (The query carries no attempts predicate — that part is
    // structural and not observable through this fake.)
    queueSelect("unmatchedEvents", [retainedRow({ attempts: 500 })]);
    queueSelect("checkoutSessions", [sessionRow()]);
    queueSelect("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    const result = await run();
    expect(result.settled).toBe(1);
  });

  it("leaves the row in place while the session still has no rate", async () => {
    queueSelect("unmatchedEvents", [retainedRow()]);
    queueSelect("checkoutSessions", [sessionRow({ fiatRateCents: null })]);

    const result = await run();

    expect(result).toMatchObject({ examined: 1, settled: 0, pending: 1 });
    expect(writeLog.find((w) => w.table === "payments")).toBeUndefined();
    expect(writeLog.find((w) => w.op === "delete")).toBeUndefined();
  });

  it("retains the row when settling throws, so the next pass retries", async () => {
    queueSelect("unmatchedEvents", [retainedRow()]);
    queueSelect("checkoutSessions", [sessionRow()]);
    queueSelect("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", new Error("connection terminated unexpectedly"));

    const result = await run();

    expect(result).toMatchObject({ settled: 0, failed: 1 });
    expect(writeLog.find((w) => w.op === "delete")).toBeUndefined();
    expect(writeLog.find((w) => w.table === "checkoutSessions")).toBeUndefined();
  });

  it("clears the row when the payment turns out to be already recorded", async () => {
    queueSelect("unmatchedEvents", [retainedRow()]);
    queueSelect("checkoutSessions", [sessionRow()]);
    queueSelect("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert(
      "payments",
      new Error('duplicate key value violates unique constraint "payments_chain_tx_idx"'),
    );

    const result = await run();

    expect(result.settled).toBe(1);
    expect(writeLog.find((w) => w.op === "delete" && w.table === "unmatchedEvents")).toBeDefined();
    // Already settled earlier — don't move completedAt.
    expect(writeLog.find((w) => w.table === "checkoutSessions")).toBeUndefined();
  });

  it("retains, never deletes, when the session no longer exists", async () => {
    queueSelect("unmatchedEvents", [retainedRow()]);
    queueSelect("checkoutSessions", []);

    const result = await run();

    expect(result).toMatchObject({ orphaned: 1, settled: 0 });
    expect(writeLog.find((w) => w.op === "delete")).toBeUndefined();
  });

  it("ignores rows belonging to another chain's process", async () => {
    queueSelect("unmatchedEvents", [
      retainedRow({ payload: { ...retainedRow().payload, chain: "litecoin" } }),
    ]);

    const result = await run();

    expect(result.examined).toBe(0);
    expect(writeLog).toHaveLength(0);
  });

  it("does not let one unusable row block the rest of the batch", async () => {
    queueSelect("unmatchedEvents", [
      retainedRow({ id: "bad", payload: { chain: "bitcoin" } }), // no sessionId
      retainedRow({ id: "good" }),
    ]);
    queueSelect("checkoutSessions", [sessionRow()]);
    queueSelect("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    const result = await run();

    expect(result).toMatchObject({ examined: 2, failed: 1, settled: 1 });
  });
});
