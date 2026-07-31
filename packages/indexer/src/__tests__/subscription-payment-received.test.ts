import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../invoices/create", () => ({
  buildInvoice: () => ({
    invoice: { organizationId: "org_1", paymentId: "pay_1", customerId: "cust_1" },
    lineItems: [{ description: "x", quantity: 1, unitAmountCents: 100, amountCents: 100 }],
    nextSequence: 2,
  }),
}));
vi.mock("../invoices/send-email", () => ({ sendInvoiceEmail: vi.fn(async () => {}) }));
vi.mock("../webhook-dispatch", () => ({
  dispatchWebhooks: vi.fn(async () => {}),
  dispatchSystemWebhook: vi.fn(async () => {}),
}));
vi.mock("../emails/send-subscription-email", () => ({
  sendSubscriptionEmail: vi.fn(async () => {}),
}));

const selectResults: unknown[][] = [];
const insertResults: unknown[][] = [];
const updateCalls: Array<{ set: Record<string, unknown> }> = [];

function thenable(chain: Record<string, unknown>, resolveWith: () => unknown[]) {
  // biome-ignore lint/suspicious/noThenProperty: deliberate thenable query-builder mock
  (chain as { then: (r: (v: unknown[]) => void) => void }).then = (resolve) => {
    resolve(resolveWith());
  };
  return chain;
}

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "offset"]) chain[m] = () => chain;
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
  const chain: Record<string, unknown> = {
    values: () => chain,
    onConflictDoNothing: () => chain,
    onConflictDoUpdate: () => chain,
    returning: () => chain,
  };
  return thenable(chain, () => insertResults.shift() ?? []);
}

const mockDb = {
  select: vi.fn(() => makeSelectChain()),
  update: vi.fn(() => makeUpdateChain()),
  insert: vi.fn(() => makeInsertChain()),
  delete: vi.fn(() => thenable({ where: () => ({}) }, () => [])),
  transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockDb)),
};

vi.mock("@paylix/db/client", () => ({ createDb: () => mockDb }));

const { handleSubscriptionPaymentReceived } = await import("../handlers");

const ctx = {
  livemode: false,
  networkKey: "base-sepolia",
  paymentVault: "0x0000000000000000000000000000000000000001" as `0x${string}`,
  subscriptionManager: "0xCONTRACT" as `0x${string}`,
};

const log = {
  transactionHash: "0xtx" as `0x${string}`,
  blockNumber: 5n,
  logIndex: 1,
} as unknown as Parameters<typeof handleSubscriptionPaymentReceived>[0];

const args = {
  subscriptionId: 42n,
  subscriber: "0xbuyer" as `0x${string}`,
  merchant: "0xmerchant" as `0x${string}`,
  token: "0xusdc" as `0x${string}`,
  amount: 1_000_000n,
  fee: 5_000n,
  timestamp: 1700000000n,
};

function queueHappyPath(subscription: Record<string, unknown>) {
  selectResults.push([subscription]); // subscription lookup
  selectResults.push([]); // no existing payment for (chain, txHash)
  selectResults.push([{ id: "prod_1", name: "P", taxRateBps: null, taxLabel: null, reverseChargeEligible: false }]);
  selectResults.push([{ id: "cust_1", customerId: "ext_1", firstName: null, lastName: null, email: null, country: null, taxId: null }]);
  selectResults.push([{ organizationId: "org_1", legalName: "", addressLine1: "", addressLine2: null, city: "", postalCode: "", country: "", taxId: null, supportEmail: "", logoUrl: null, invoicePrefix: "INV-", invoiceFooter: null, invoiceSequence: 1 }]);

  insertResults.push([{ id: "pay_1", amount: 100 }]); // payment
  insertResults.push([]); // merchantProfiles upsert
  insertResults.push([{ id: "inv_1", number: "INV-1", totalCents: 100, currency: "USDC", hostedToken: "tok" }]);
  insertResults.push([]); // line items
}

const SUBSCRIPTION = {
  id: "sub_1",
  organizationId: "org_1",
  productId: "prod_1",
  customerId: "cust_1",
  networkKey: "base-sepolia",
  tokenSymbol: "USDC",
  nextChargeDate: new Date("2026-08-01T00:00:00Z"),
  currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
  currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
  lastPaymentId: "pay_0",
  trialConvertedEmailSentAt: null,
  metadata: {},
  status: "past_due",
  chargeFailureCount: 4,
  pastDueSince: new Date("2026-07-15T00:00:00Z"),
};

describe("handleSubscriptionPaymentReceived", () => {
  beforeEach(() => {
    selectResults.length = 0;
    insertResults.length = 0;
    updateCalls.length = 0;
    mockDb.select.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("clears the dunning counters when a charge confirms on-chain", async () => {
    // A confirmed charge is the authoritative "this subscriber paid" signal.
    // The keeper can miss it — a charge that confirms after the receipt timeout
    // increments chargeFailureCount even though the money moved — so without
    // this reset a subscriber who paid every invoice eventually lands in
    // past_due and gets cancelled by the long-past-due sweep.
    queueHappyPath({ ...SUBSCRIPTION });

    await handleSubscriptionPaymentReceived(log, args, ctx);

    const subscriptionUpdate = updateCalls.at(-1)?.set ?? {};
    expect(subscriptionUpdate).toMatchObject({
      status: "active",
      chargeFailureCount: 0,
      lastChargeError: null,
      pastDueSince: null,
      lastPaymentId: "pay_1",
    });
    expect(subscriptionUpdate.nextChargeDate).toBeInstanceOf(Date);
  });

  it("skips when a payment for the same (chain, txHash) already exists", async () => {
    selectResults.push([{ ...SUBSCRIPTION }]);
    selectResults.push([{ id: "pay_existing" }]);

    await handleSubscriptionPaymentReceived(log, args, ctx);

    expect(updateCalls).toHaveLength(0);
  });
});
