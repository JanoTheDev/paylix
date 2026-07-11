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
import { payments, checkoutSessions, unmatchedEvents, subscriptions } from "@paylix/db/schema";

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

const mockDb = {
  select: vi.fn(() => makeSelectChain()),
  update: vi.fn((_table: unknown) => makeUpdateChain()),
  insert: mockDbInsertRouter,
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

  it("does not throw when the subscription insert hits a duplicate unique constraint", async () => {
    selectResults.push([matchingSession({ status: "active" })]);
    insertResults.push(
      new Error(
        'duplicate key value violates unique constraint "subscriptions_contract_on_chain_id_idx"',
      ),
    );

    const callbacks = makeSolanaDbCallbacks({ db: mockDb as never, networkKey: "solana" });
    await expect(callbacks.recordSubscriptionCreated(baseSubCreatedEvent)).resolves.not.toThrow();

    // Session still gets flipped to completed even though the subscription insert raced.
    expect(updateCalls[0].set).toMatchObject({ status: "completed" });
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
