import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AddressPaymentHit } from "@paylix/utxo-watcher";
import {
  checkoutSessions,
  customers,
  payments,
  unmatchedEvents,
  webhooks,
  webhookDeliveries,
} from "@paylix/db/schema";
import { makeUtxoDbCallbacks, satsToCents } from "../db-callbacks";

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
/** Every write in call order, so ordering assertions are possible. */
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
const RECEIVE_ADDRESS = "bc1qsession4address";

/** $60,000.00 per BTC, in cents per whole coin. */
const BTC_RATE_CENTS = 6_000_000;

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    organizationId: "org_1",
    productId: "prod_1",
    customerId: null,
    merchantWallet: "merchant",
    amount: 100_000n, // 0.001 BTC expected
    tokenSymbol: "BTC",
    btcReceiveAddress: RECEIVE_ADDRESS,
    fiatRateCents: BTC_RATE_CENTS,
    fiatRateCapturedAt: new Date("2026-07-31T00:00:00Z"),
    livemode: false,
    ...overrides,
  };
}

function hit(overrides: Partial<AddressPaymentHit> = {}): AddressPaymentHit {
  return {
    txid: "tx-1",
    blockHeight: 900,
    confirmations: 6,
    vout: 0,
    valueSats: 100_000n,
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

function callbacks() {
  return makeUtxoDbCallbacks({ db: mockDb as never, networkKey: "bitcoin" });
}

describe("satsToCents", () => {
  it("converts using the quote-time fiat rate, not a unit-price assumption", () => {
    // 0.001 BTC at $60,000/BTC == $60.00 == 6000 cents. Writing satoshis
    // verbatim reported this as $1,000.00; dividing by 10^(8-2) reported
    // $0.00 and made the payment non-refundable. See IDX-04.
    expect(satsToCents(100_000n, BTC_RATE_CENTS)).toBe(6_000);
    expect(satsToCents(100_000_000n, BTC_RATE_CENTS)).toBe(6_000_000);
  });

  it("always returns an integer and rounds half-up", () => {
    expect(satsToCents(1n, BTC_RATE_CENTS)).toBe(0); // 0.06 cents
    expect(satsToCents(834n, BTC_RATE_CENTS)).toBe(50); // 50.04 cents
    expect(satsToCents(8_334n, BTC_RATE_CENTS)).toBe(500); // 500.04 cents
    expect(satsToCents(8_342n, BTC_RATE_CENTS)).toBe(501); // 500.52 cents
    for (const sats of [1n, 12_345n, 999_999n, 123_456_789n]) {
      expect(Number.isInteger(satsToCents(sats, BTC_RATE_CENTS))).toBe(true);
    }
  });

  it("uses exact integer math — no float drift on large amounts", () => {
    // 21,000,000 BTC at 1 cent/BTC is exactly 21,000,000 cents.
    expect(satsToCents(2_100_000_000_000_000n, 1)).toBe(21_000_000);
  });

  it("refuses a missing or non-positive rate rather than inventing one", () => {
    expect(() => satsToCents(100_000n, 0)).toThrow(/positive integer/);
    expect(() => satsToCents(100_000n, -5)).toThrow(/positive integer/);
    expect(() => satsToCents(100_000n, Number.NaN)).toThrow(/positive integer/);
  });

  it("handles zero", () => {
    expect(satsToCents(0n, BTC_RATE_CENTS)).toBe(0);
  });
});

describe("onPayment", () => {
  it("writes amount from the fiat rate and the exact sats alongside it", async () => {
    queueSelect("checkoutSessions", [session()]);
    queueSelect("customers", []);
    queueInsert("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    await callbacks().onPayment(SESSION_ID, hit());

    const insert = writeLog.find((w) => w.op === "insert" && w.table === "payments");
    expect(insert!.values).toMatchObject({
      organizationId: "org_1",
      customerId: CUSTOMER_UUID,
      amount: 6_000, // $60.00 — not 100000, not 0
      amountSats: 100_000n,
      fiatRateCents: BTC_RATE_CENTS,
      chain: "bitcoin",
      txHash: "tx-1",
      status: "confirmed",
    });
  });

  it("records the amount actually received, so an overpayment is not under-reported", async () => {
    queueSelect("checkoutSessions", [session()]);
    queueSelect("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    await callbacks().onPayment(SESSION_ID, hit({ valueSats: 150_000n }));

    const insert = writeLog.find((w) => w.op === "insert" && w.table === "payments");
    expect(insert!.values).toMatchObject({ amountSats: 150_000n, amount: 9_000 });
  });

  it("writes the payment row BEFORE completing the session", async () => {
    queueSelect("checkoutSessions", [session()]);
    queueSelect("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    await callbacks().onPayment(SESSION_ID, hit());

    const ops = writeLog.map((w) => `${w.op}:${w.table}`);
    const paymentAt = ops.indexOf("insert:payments");
    const sessionAt = ops.indexOf("update:checkoutSessions");
    expect(paymentAt).toBeGreaterThanOrEqual(0);
    expect(sessionAt).toBeGreaterThan(paymentAt);
  });

  it("refuses to write a cents amount when the session carries no fiat rate", async () => {
    queueSelect("checkoutSessions", [session({ fiatRateCents: null })]);

    await callbacks().onPayment(SESSION_ID, hit());

    // No payment row and no completed session — a knowingly-wrong money
    // value is never stored (IDX-04).
    expect(writeLog.find((w) => w.table === "payments")).toBeUndefined();
    expect(writeLog.find((w) => w.table === "checkoutSessions")).toBeUndefined();
    const retained = writeLog.find((w) => w.table === "unmatchedEvents");
    expect(retained!.values).toMatchObject({
      eventType: "UtxoPaymentReceivedNoFiatRate",
      txHash: "tx-1",
    });
  });

  it("propagates a non-unique insert failure and leaves the session open", async () => {
    queueSelect("checkoutSessions", [session()]);
    queueSelect("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", new Error("connection terminated unexpectedly"));

    await expect(callbacks().onPayment(SESSION_ID, hit())).rejects.toThrow(
      /connection terminated/,
    );
    expect(writeLog.find((w) => w.table === "checkoutSessions")).toBeUndefined();
  });

  it("tolerates a duplicate txid without re-stamping completedAt", async () => {
    queueSelect("checkoutSessions", [session()]);
    queueSelect("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert(
      "payments",
      new Error('duplicate key value violates unique constraint "payments_chain_tx_idx"'),
    );

    await expect(callbacks().onPayment(SESSION_ID, hit())).resolves.toBeUndefined();
    // The first delivery already completed it; a second must not move the
    // settlement timestamp.
    expect(writeLog.find((w) => w.table === "checkoutSessions")).toBeUndefined();
  });

  it("survives the customer insert race instead of losing the payment", async () => {
    queueSelect("checkoutSessions", [session()]);
    // Concurrent hit for the same org: our lookup misses...
    queueSelect("customers", []);
    // ...our insert conflicts, so onConflictDoNothing returns no row...
    queueInsert("customers", []);
    // ...and the recovery re-select finds the row the other writer created.
    queueSelect("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    await callbacks().onPayment(SESSION_ID, hit());

    expect(writeLog.find((w) => w.op === "insert" && w.table === "customers")).toBeDefined();
    const paymentInsert = writeLog.find((w) => w.op === "insert" && w.table === "payments");
    expect(paymentInsert!.values).toMatchObject({ customerId: CUSTOMER_UUID });
  });

  it("keys anonymous buyers on the single-use receive address, not the org", async () => {
    queueSelect("checkoutSessions", [session()]);
    queueSelect("customers", []);
    queueInsert("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    await callbacks().onPayment(SESSION_ID, hit());

    const customerInsert = writeLog.find((w) => w.op === "insert" && w.table === "customers");
    // Two buyers of the same org must never collapse into one customer row —
    // that customer's portal would list both buyers' payments and could
    // refund them.
    expect(customerInsert!.values).toMatchObject({
      organizationId: "org_1",
      customerId: `anon_${RECEIVE_ADDRESS}`,
    });
  });

  it("prefers the merchant-supplied customer identifier when present", async () => {
    queueSelect("checkoutSessions", [session({ customerId: "cust_ext_9" })]);
    queueSelect("customers", []);
    queueInsert("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    await callbacks().onPayment(SESSION_ID, hit());

    const customerInsert = writeLog.find((w) => w.op === "insert" && w.table === "customers");
    expect(customerInsert!.values).toMatchObject({ customerId: "cust_ext_9" });
  });

  it("throws when the session has disappeared rather than writing an orphan payment", async () => {
    queueSelect("checkoutSessions", []);
    await expect(callbacks().onPayment(SESSION_ID, hit())).rejects.toThrow(
      /no checkout session/,
    );
    expect(writeLog).toHaveLength(0);
  });
});

describe("onUnderpayment", () => {
  it("retains the shortfall so it is visible after the session expires", async () => {
    queueSelect("checkoutSessions", [{ livemode: true }]);

    await callbacks().onUnderpayment!(SESSION_ID, hit({ valueSats: 99_999n }), 1n);

    const retained = writeLog.find((w) => w.table === "unmatchedEvents");
    expect(retained!.values).toMatchObject({
      eventType: "UtxoUnderpayment",
      txHash: "tx-1",
      livemode: true,
    });
    expect((retained!.values as { payload: Record<string, string> }).payload).toMatchObject({
      sessionId: SESSION_ID,
      receivedSats: "99999",
      shortfallSats: "1",
    });
  });
});
