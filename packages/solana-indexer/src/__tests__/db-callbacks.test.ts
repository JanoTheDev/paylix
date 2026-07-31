import { describe, it, expect, vi, beforeEach } from "vitest";
import { keccak256, stringToBytes } from "viem";
import { makeSolanaDbCallbacks } from "../db-callbacks";

// Table objects imported from @paylix/db/schema are distinct object
// identities; we tag which table a select/insert targets by object
// reference so the mock can route correctly.
import {
  payments,
  checkoutSessions,
  customers,
  unmatchedEvents,
  subscriptions,
  webhooks,
  webhookDeliveries,
} from "@paylix/db/schema";

type QueryResult = unknown[];

function tableName(t: unknown): string {
  if (t === payments) return "payments";
  if (t === checkoutSessions) return "checkoutSessions";
  if (t === customers) return "customers";
  if (t === subscriptions) return "subscriptions";
  if (t === unmatchedEvents) return "unmatchedEvents";
  if (t === webhooks) return "webhooks";
  if (t === webhookDeliveries) return "webhookDeliveries";
  return "unknown";
}

const selectQueues: Record<string, QueryResult[]> = {};
const insertQueues: Record<string, Array<QueryResult | Error>> = {};
const updateCalls: Array<{ table: string; set: Record<string, unknown> }> = [];
const insertCalls: Array<{ table: string; values: unknown }> = [];

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
  const captured = { table, set: {} as Record<string, unknown> };
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
    insertCalls.push({ table, values: captured.values });
    const next = insertQueues[table]?.shift() ?? [];
    if (next instanceof Error) reject(next);
    else resolve(next);
  };
  return chain;
}

const mockDb = {
  select: vi.fn(() => makeSelectChain()),
  update: vi.fn((table: unknown) => makeUpdateChain(tableName(table))),
  insert: vi.fn((table: unknown) => makeInsertChain(tableName(table))),
};

const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";
const CUSTOMER_UUID = "660e8400-e29b-41d4-a716-446655440000";
const PAYMENT_UUID = "770e8400-e29b-41d4-a716-446655440000";
const SUBSCRIPTION_UUID = "880e8400-e29b-41d4-a716-446655440000";

beforeEach(() => {
  for (const k of Object.keys(selectQueues)) delete selectQueues[k];
  for (const k of Object.keys(insertQueues)) delete insertQueues[k];
  updateCalls.length = 0;
  insertCalls.length = 0;
  mockDb.select.mockClear();
  mockDb.update.mockClear();
  mockDb.insert.mockClear();
  // Every payment path resolves the merchant-supplied text identifier to a
  // customers row; default to an existing customer with a wallet on file.
  queueSelect("customers", [{ id: CUSTOMER_UUID, walletAddress: "buyer_pubkey" }]);
});

function matchingSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SESSION_ID,
    organizationId: "org_1",
    productId: "prod_1",
    customerId: "cust_ext_1",
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
  it("inserts a payment row against the resolved customer uuid and completes the session", async () => {
    queueSelect("checkoutSessions", [matchingSession()]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordPayment(basePaymentEvent);

    const paymentInsert = insertCalls.find((c) => c.table === "payments");
    expect(paymentInsert).toBeDefined();
    expect(paymentInsert!.values).toMatchObject({
      productId: "prod_1",
      organizationId: "org_1",
      // The uuid from `customers`, NOT the merchant-supplied text identifier.
      customerId: CUSTOMER_UUID,
      amount: 100, // 1_000_000 / 10^(6-2) = 100 cents
      fee: 1, // 5_000 / 10^(6-2) = 0.5, rounded to nearest cent
      status: "confirmed",
      txHash: "sig_1",
      chain: "solana",
      token: "USDC",
      fromAddress: "buyer_pubkey",
      toAddress: "merchant_pubkey",
      blockNumber: 100,
      livemode: false,
    });
    const sessionUpdate = updateCalls.find((c) => c.table === "checkoutSessions");
    expect(sessionUpdate!.set).toMatchObject({ status: "completed", paymentId: PAYMENT_UUID });
    expect(sessionUpdate!.set.completedAt).toBeInstanceOf(Date);
  });

  it("creates the customer row when the identifier is new", async () => {
    // Override the default: no existing customer.
    selectQueues.customers = [[]];
    queueSelect("checkoutSessions", [matchingSession()]);
    queueInsert("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordPayment(basePaymentEvent);

    const customerInsert = insertCalls.find((c) => c.table === "customers");
    expect(customerInsert!.values).toMatchObject({
      organizationId: "org_1",
      customerId: "cust_ext_1",
      walletAddress: "buyer_pubkey",
    });
    const paymentInsert = insertCalls.find((c) => c.table === "payments");
    expect(paymentInsert!.values).toMatchObject({ customerId: CUSTOMER_UUID });
  });

  it("survives the customer insert race instead of losing the payment", async () => {
    // Concurrent event for the same org: our lookup misses, our insert
    // conflicts (onConflictDoNothing returns no row), and the recovery
    // re-select finds the row the other writer created. Without
    // onConflictDoNothing the insert would reject with 23505 and the payment
    // would never be written.
    selectQueues.customers = [[], [{ id: CUSTOMER_UUID }]];
    queueSelect("checkoutSessions", [matchingSession()]);
    queueInsert("customers", []);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordPayment(basePaymentEvent);

    expect(insertCalls.find((c) => c.table === "customers")).toBeDefined();
    const paymentInsert = insertCalls.find((c) => c.table === "payments");
    expect(paymentInsert!.values).toMatchObject({ customerId: CUSTOMER_UUID });
  });

  it("throws rather than writing an orphan payment when the customer cannot be resolved", async () => {
    // Insert conflicted AND the re-select still finds nothing — genuinely
    // unresolvable, so nothing may be written.
    selectQueues.customers = [[], []];
    queueSelect("checkoutSessions", [matchingSession()]);
    queueInsert("customers", []);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await expect(callbacks.recordPayment(basePaymentEvent)).rejects.toThrow(
      /Failed to resolve customer/,
    );
    expect(insertCalls.find((c) => c.table === "payments")).toBeUndefined();
    expect(updateCalls.find((c) => c.table === "checkoutSessions")).toBeUndefined();
  });

  it("synthesizes an anonymous customer when the session carries no identifier", async () => {
    selectQueues.customers = [[]];
    queueSelect("checkoutSessions", [matchingSession({ customerId: null })]);
    queueInsert("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordPayment(basePaymentEvent);

    const customerInsert = insertCalls.find((c) => c.table === "customers");
    expect(customerInsert!.values).toMatchObject({ customerId: "anon_buyer_pubkey" });
    expect(insertCalls.find((c) => c.table === "payments")).toBeDefined();
  });

  it("records an unmatched event when no session matches", async () => {
    queueSelect("checkoutSessions", []);

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
    queueSelect("checkoutSessions", [matchingSession()]);
    queueInsert(
      "payments",
      new Error('duplicate key value violates unique constraint "payments_chain_tx_idx"'),
    );

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await expect(callbacks.recordPayment(basePaymentEvent)).resolves.not.toThrow();

    // The first delivery already completed the session; a redelivery must not
    // re-stamp completedAt and move the settlement timestamp.
    expect(updateCalls.find((c) => c.table === "checkoutSessions")).toBeUndefined();
  });

  it("propagates a non-duplicate payment insert failure and leaves the session open", async () => {
    queueSelect("checkoutSessions", [matchingSession()]);
    queueInsert("payments", new Error("connection terminated unexpectedly"));

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await expect(callbacks.recordPayment(basePaymentEvent)).rejects.toThrow(
      /connection terminated/,
    );

    // A payment we failed to record must never present as a completed session.
    expect(updateCalls.find((c) => c.table === "checkoutSessions")).toBeUndefined();
  });

  it("records an unmatched event when the mint is unrecognized, without throwing", async () => {
    queueSelect("checkoutSessions", [matchingSession()]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordPayment({
      ...basePaymentEvent,
      mint: "UnknownMint1111111111111111111111111111",
    });

    const unmatchedInsert = insertCalls.find((c) => c.table === "unmatchedEvents");
    expect(unmatchedInsert).toBeDefined();
    expect(unmatchedInsert!.values).toMatchObject({ eventType: "SolanaPaymentReceivedUnknownMint" });
    expect(insertCalls.find((c) => c.table === "payments")).toBeUndefined();
  });

  it("dispatches payment.confirmed to a matching webhook", async () => {
    queueSelect("checkoutSessions", [matchingSession()]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);
    queueSelect("webhooks", [
      {
        id: "wh_1",
        // Literal public IP so the URL guard needs no DNS in tests.
        url: "https://93.184.216.34/paylix",
        secret: "shh",
        events: ["payment.confirmed"],
        isActive: true,
        livemode: false,
      },
    ]);
    queueInsert("webhookDeliveries", [{ id: "del_1" }]);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordPayment(basePaymentEvent);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://93.184.216.34/paylix");
    expect((init.headers as Record<string, string>)["x-paylix-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    vi.unstubAllGlobals();
  });
});

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
    queueSelect("checkoutSessions", [matchingSession({ status: "active" })]);
    queueInsert("subscriptions", [{ id: SUBSCRIPTION_UUID }]);

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
    const sessionUpdate = updateCalls.find((c) => c.table === "checkoutSessions");
    expect(sessionUpdate!.set).toMatchObject({ status: "completed" });
  });

  it("records an unmatched event when no session matches", async () => {
    queueSelect("checkoutSessions", []);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordSubscriptionCreated(baseSubCreatedEvent);

    const unmatchedInsert = insertCalls.find((c) => c.table === "unmatchedEvents");
    expect(unmatchedInsert!.values).toMatchObject({ eventType: "SolanaSubscriptionCreated" });
  });

  it("resolves a customer even when the matched session has no identifier", async () => {
    selectQueues.customers = [[]];
    queueSelect("checkoutSessions", [matchingSession({ customerId: null })]);
    queueInsert("customers", [{ id: CUSTOMER_UUID }]);
    queueInsert("subscriptions", [{ id: SUBSCRIPTION_UUID }]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordSubscriptionCreated(baseSubCreatedEvent);

    // subscriptions.customerId is NOT NULL — an anonymous customer row is
    // created rather than dropping the event.
    const customerInsert = insertCalls.find((c) => c.table === "customers");
    expect(customerInsert!.values).toMatchObject({ customerId: "anon_subscriber_pubkey" });
    expect(insertCalls.find((c) => c.table === "subscriptions")).toBeDefined();
  });

  it("does not throw when the subscription insert hits a duplicate unique constraint", async () => {
    queueSelect("checkoutSessions", [matchingSession({ status: "active" })]);
    queueInsert(
      "subscriptions",
      new Error(
        'duplicate key value violates unique constraint "subscriptions_contract_on_chain_id_idx"',
      ),
    );

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await expect(callbacks.recordSubscriptionCreated(baseSubCreatedEvent)).resolves.not.toThrow();

    // Already recorded on the first delivery — the session is left as-is.
    expect(updateCalls.find((c) => c.table === "checkoutSessions")).toBeUndefined();
  });
});

function matchingSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sub_row_1",
    productId: "prod_1",
    organizationId: "org_1",
    customerId: CUSTOMER_UUID,
    contractAddress: "prog_manager",
    onChainId: "42",
    intervalSeconds: 2_592_000,
    nextChargeDate: null,
    tokenSymbol: "USDC",
    networkKey: "solana",
    status: "active",
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
    queueSelect("subscriptions", [matchingSubscription()]);
    queueInsert("payments", [{ id: PAYMENT_UUID }]);

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
    const subUpdate = updateCalls.find((c) => c.table === "subscriptions");
    expect(subUpdate!.set.nextChargeDate).toBeInstanceOf(Date);
    expect(subUpdate!.set).toMatchObject({
      pastDueSince: null,
      chargeFailureCount: 0,
      lastPaymentId: PAYMENT_UUID,
    });
  });

  it("records an unmatched event when no subscription matches", async () => {
    queueSelect("subscriptions", []);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordSubscriptionCharged(baseSubChargedEvent);

    const unmatchedInsert = insertCalls.find((c) => c.table === "unmatchedEvents");
    expect(unmatchedInsert!.values).toMatchObject({ eventType: "SolanaSubscriptionCharged" });
    expect(insertCalls.find((c) => c.table === "payments")).toBeUndefined();
  });

  it("does not throw on a duplicate charge signature", async () => {
    queueSelect("subscriptions", [matchingSubscription()]);
    queueInsert(
      "payments",
      new Error('duplicate key value violates unique constraint "payments_chain_tx_idx"'),
    );

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await expect(callbacks.recordSubscriptionCharged(baseSubChargedEvent)).resolves.not.toThrow();
    expect(updateCalls.length).toBe(0);
  });

  it("propagates a non-duplicate insert failure so the period is not advanced", async () => {
    queueSelect("subscriptions", [matchingSubscription()]);
    queueInsert("payments", new Error("deadlock detected"));

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await expect(callbacks.recordSubscriptionCharged(baseSubChargedEvent)).rejects.toThrow(
      /deadlock/,
    );
    expect(updateCalls.length).toBe(0);
  });
});

const baseSubCancelledEvent = {
  signature: "sig_cancel_1",
  slot: 400,
  programId: "prog_manager",
  subscriptionId: 42n,
};

describe("makeSolanaDbCallbacks().recordSubscriptionCancelled", () => {
  it("flips the subscription to cancelled on a match", async () => {
    queueSelect("subscriptions", [matchingSubscription()]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordSubscriptionCancelled(baseSubCancelledEvent);

    expect(updateCalls[0].set).toMatchObject({ status: "cancelled" });
  });

  it("records an unmatched event when no subscription matches", async () => {
    queueSelect("subscriptions", []);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await callbacks.recordSubscriptionCancelled(baseSubCancelledEvent);

    const unmatchedInsert = insertCalls.find((c) => c.table === "unmatchedEvents");
    expect(unmatchedInsert!.values).toMatchObject({ eventType: "SolanaSubscriptionCancelled" });
  });

  it("is idempotent on redelivery — re-cancelling an already-cancelled subscription does not throw", async () => {
    queueSelect("subscriptions", [matchingSubscription({ status: "cancelled" })]);

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await expect(callbacks.recordSubscriptionCancelled(baseSubCancelledEvent)).resolves.not.toThrow();
    expect(updateCalls[0].set).toMatchObject({ status: "cancelled" });
  });
});
