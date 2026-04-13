import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock network config ---
vi.mock("@paylix/config/networks", () => ({
  NETWORKS: {
    "base-sepolia": {
      tokens: {
        USDC: { address: "0xusdc", decimals: 6 },
      },
    },
  },
  getToken: () => ({ decimals: 6, address: "0xusdc", symbol: "USDC" }),
}));

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

// --- Mock invoice helpers ---
vi.mock("../invoices/create", () => ({
  buildInvoice: () => ({
    invoice: {
      organizationId: "org_1",
      paymentId: "pay_trial_1",
      customerId: "cust_1",
      hostedToken: "tok_hosted",
      number: "INV-000001",
      merchantLegalName: "Test Co",
      merchantAddressLine1: "",
      merchantAddressLine2: null,
      merchantCity: "",
      merchantPostalCode: "",
      merchantCountry: "",
      merchantTaxId: null,
      merchantSupportEmail: "",
      merchantLogoUrl: null,
      merchantFooter: null,
      customerName: null,
      customerEmail: null,
      customerCountry: null,
      customerTaxId: null,
      customerAddress: null,
      currency: "USDC",
      subtotalCents: 100,
      taxCents: 0,
      totalCents: 100,
      taxLabel: null,
      taxRateBps: null,
      reverseCharge: false,
    },
    lineItems: [{ description: "Test", quantity: 1, unitAmountCents: 100, amountCents: 100 }],
    nextSequence: 2,
  }),
}));

vi.mock("../invoices/send-email", () => ({
  sendInvoiceEmail: vi.fn(async () => {}),
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
const insertResults: QueryResult[] = [];
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
    resolve(insertResults.shift() ?? []);
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
import type { HandlerContext } from "../handlers";

const testCtx: HandlerContext = {
  livemode: false,
  networkKey: "base-sepolia",
  paymentVault: "0x0000000000000000000000000000000000000001",
  subscriptionManager: "0xCONTRACT",
};

const TRIAL_ROW = {
  id: "sub_trial_1",
  organizationId: "org_1",
  subscriberAddress: "0xBuyer",
  contractAddress: "0xcontract",
  status: "trialing",
  productId: "prod_1",
  customerId: "cust_1",
  networkKey: "base-sepolia",
  tokenSymbol: "USDC",
  metadata: {},
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
    insertResults.length = 0;
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
    // 3rd select: product lookup for invoice
    selectResults.push([{ id: "prod_1", name: "Test Product", taxRateBps: null, taxLabel: null, reverseChargeEligible: false }]);
    // 4th select: merchant profile lookup
    selectResults.push([{ organizationId: "org_1", legalName: "", addressLine1: "", addressLine2: null, city: "", postalCode: "", country: "", taxId: null, supportEmail: "", logoUrl: null, invoicePrefix: "INV-", invoiceFooter: null, invoiceSequence: 1 }]);
    // 5th select: customer lookup
    selectResults.push([{ id: "cust_1", customerId: "cust_ext_1", firstName: null, lastName: null, email: null, country: null, taxId: null }]);

    // Insert results: 1st = payment row, 2nd = merchantProfile upsert (no returning),
    // 3rd = invoice row, 4th = invoice line items
    insertResults.push([{ id: "pay_trial_1", amount: 100 }]);
    insertResults.push([]); // merchantProfile onConflictDoNothing
    insertResults.push([{ id: "inv_1", number: "INV-000001", totalCents: 100, currency: "USDC", hostedToken: "tok_hosted" }]);
    insertResults.push([]); // invoice line items

    await handleSubscriptionCreated(baseLog, baseArgs, testCtx);

    // First update: set subscription to active
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

    // Second update: link lastPaymentId
    expect(updateCalls[1].set).toMatchObject({ lastPaymentId: "pay_trial_1" });

    // Payment insert was issued (not a subscription insert).
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    expect(insertCalls[0].values).toMatchObject({
      productId: "prod_1",
      organizationId: "org_1",
      customerId: "cust_1",
      status: "confirmed",
    });

    // trial_converted webhook dispatched.
    expect(dispatchWebhooks).toHaveBeenCalledWith(
      "org_1",
      "subscription.trial_converted",
      expect.objectContaining({
        subscriptionId: "sub_trial_1",
        onChainId: "42",
      }),
    );

    // subscription.created webhook dispatched.
    expect(dispatchWebhooks).toHaveBeenCalledWith(
      "org_1",
      "subscription.created",
      expect.objectContaining({
        subscriptionId: "sub_trial_1",
        onChainId: "42",
        productId: "prod_1",
      }),
    );
  });

  it("falls through to the checkout-session flow when no trialing row matches", async () => {
    // 1st select: idempotency check -> empty
    selectResults.push([]);
    // 2nd select: trial-match query -> empty (no trial row)
    selectResults.push([]);
    // 3rd select: checkout session candidates -> empty (no match)
    selectResults.push([]);

    await handleSubscriptionCreated(baseLog, baseArgs, testCtx);

    // The early-return trial path did NOT fire: no update was issued.
    expect(updateCalls).toHaveLength(0);
    // And no trial_converted webhook either.
    expect(dispatchWebhooks).not.toHaveBeenCalledWith(
      expect.anything(),
      "subscription.trial_converted",
      expect.anything(),
    );
    // Three selects ran (idempotency + trial-match + checkout candidates).
    expect(mockDb.select.mock.calls.length).toBe(3);
    // An unmatched event insert was issued (recordUnmatched).
    expect(mockDb.insert).toHaveBeenCalled();
  });
});
