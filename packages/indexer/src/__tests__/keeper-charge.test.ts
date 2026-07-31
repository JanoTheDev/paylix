import { describe, it, expect, vi, beforeEach } from "vitest";

const CONTRACT = "0xmanager";

const writeContract = vi.fn(async () => "0xtx" as `0x${string}`);
const waitForTransactionReceipt = vi.fn(async () => ({
  status: "success" as "success" | "reverted",
  blockNumber: 10n,
}));

vi.mock("viem", () => ({
  createWalletClient: () => ({ writeContract }),
  createPublicClient: () => ({ waitForTransactionReceipt }),
  http: () => ({}),
}));
vi.mock("viem/accounts", () => ({
  privateKeyToAccount: () => ({ address: "0xkeeper" }),
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
  deployments: [
    {
      networkKey: "base-sepolia",
      livemode: false,
      chain: { id: 84532 },
      rpcUrl: "http://rpc",
      paymentVault: "0xvault",
      subscriptionManager: CONTRACT,
    },
  ],
  parsePositiveIntEnv: (_name: string, fallback: number) => fallback,
}));

const dispatchWebhooks = vi.fn(async () => {});
vi.mock("../webhook-dispatch", () => ({
  dispatchWebhooks: (...a: unknown[]) => dispatchWebhooks(...(a as [])),
}));
vi.mock("../emails/send-subscription-email", () => ({
  sendSubscriptionEmail: vi.fn(async () => {}),
}));

// --- Chainable drizzle mock ---
const selectResults: unknown[][] = [];
const updateReturns: unknown[][] = [];
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
    return updateReturns.shift() ?? [];
  });
}

const mockDb = {
  select: vi.fn(() => makeSelectChain()),
  update: vi.fn(() => makeUpdateChain()),
  insert: vi.fn(() => thenable({ values: () => ({}) }, () => [])),
};

vi.mock("@paylix/db/client", () => ({ createDb: () => mockDb }));

const { runKeeper } = await import("../keeper");

const DUE_AT = new Date("2026-07-01T00:00:00Z");

function dueSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    organizationId: "org_1",
    onChainId: "42",
    contractAddress: CONTRACT,
    status: "active",
    isGift: false,
    giftExpiresAt: null,
    cancelAtPeriodEnd: false,
    nextChargeDate: DUE_AT,
    intervalSeconds: 2592000,
    chargeFailureCount: 0,
    pastDueSince: null,
    metadata: {},
    livemode: false,
    ...overrides,
  };
}

describe("runKeeper charge path", () => {
  beforeEach(() => {
    selectResults.length = 0;
    updateReturns.length = 0;
    updateCalls.length = 0;
    writeContract.mockClear();
    writeContract.mockResolvedValue("0xtx");
    waitForTransactionReceipt.mockClear();
    waitForTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 10n });
    dispatchWebhooks.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("charges and clears the dunning state when the receipt succeeds", async () => {
    selectResults.push([dueSubscription()]);
    updateReturns.push([{ id: "sub_1" }]); // claim wins

    await runKeeper();

    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(updateCalls[0].set).toMatchObject({ nextChargeDate: expect.any(Date) });
    expect(updateCalls[1].set).toMatchObject({
      chargeFailureCount: 0,
      lastChargeError: null,
      pastDueSince: null,
    });
  });

  it("skips the row when the conditional claim matches nothing", async () => {
    // Another keeper instance (or an overlapping tick) already claimed it —
    // charging anyway would double-charge the subscriber.
    selectResults.push([dueSubscription()]);
    updateReturns.push([]); // claim lost

    await runKeeper();

    expect(writeContract).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(1);
  });

  it("treats a reverted charge as a failure and runs dunning", async () => {
    selectResults.push([dueSubscription({ chargeFailureCount: 0 })]);
    updateReturns.push([{ id: "sub_1" }]);
    waitForTransactionReceipt.mockResolvedValueOnce({
      status: "reverted",
      blockNumber: 10n,
    });

    await runKeeper();

    const dunning = updateCalls[1].set;
    expect(dunning).toMatchObject({ chargeFailureCount: 1 });
    expect(dunning.lastChargeError).toEqual(expect.stringContaining("reverted"));
    // Must NOT look like a success: a retry is scheduled and the counters are
    // not cleared.
    expect(dunning.nextChargeDate).toBeInstanceOf(Date);
    expect(dunning).not.toMatchObject({ chargeFailureCount: 0 });
    expect(dunning).not.toHaveProperty("pastDueSince", null);
  });

  it("escalates to past_due after the retry schedule is exhausted", async () => {
    selectResults.push([dueSubscription({ chargeFailureCount: 3 })]);
    updateReturns.push([{ id: "sub_1" }]);
    waitForTransactionReceipt.mockResolvedValueOnce({
      status: "reverted",
      blockNumber: 10n,
    });

    await runKeeper();

    expect(updateCalls[1].set).toMatchObject({
      status: "past_due",
      chargeFailureCount: 4,
    });
  });

  it("escalates a token-level revert straight to past_due instead of retrying forever", async () => {
    // Payability is pre-checked on-chain, so a blacklisted subscriber reverts
    // inside transferFrom — which rolls back the contract's own PastDue write.
    // Retrying is provably useless and each attempt costs gas plus a receipt
    // wait in this sequential loop.
    selectResults.push([dueSubscription({ chargeFailureCount: 0 })]);
    updateReturns.push([{ id: "sub_1" }]);
    writeContract.mockRejectedValueOnce(
      new Error("execution reverted: Blacklistable: account is blacklisted"),
    );

    await runKeeper();

    expect(updateCalls[1].set).toMatchObject({
      status: "past_due",
      chargeFailureCount: 1,
      pastDueSince: expect.any(Date),
    });
    // The contract can't emit SubscriptionPastDue in this case, so the keeper
    // has to tell the merchant.
    expect(dispatchWebhooks).toHaveBeenCalledWith(
      "org_1",
      "subscription.past_due",
      expect.objectContaining({ subscriptionId: "sub_1", reason: "token_blocked" }),
      false,
    );
  });

  it("does not count a transient failure against the subscriber", async () => {
    selectResults.push([dueSubscription({ chargeFailureCount: 2 })]);
    updateReturns.push([{ id: "sub_1" }]);
    writeContract.mockRejectedValueOnce(
      new Error("reverted with custom error EnforcedPause()"),
    );

    await runKeeper();

    const update = updateCalls[1].set;
    expect(update).toMatchObject({ chargeFailureCount: 2 }); // unchanged
    expect(update.status).toBeUndefined(); // not escalated
    // Retried in minutes, not after the 24h ladder step.
    const retryInMs = (update.nextChargeDate as Date).getTime() - Date.now();
    expect(retryInMs).toBeLessThan(60 * 60 * 1000);
  });

  it("keeps the normal ladder for an unclassified revert", async () => {
    selectResults.push([dueSubscription({ chargeFailureCount: 0 })]);
    updateReturns.push([{ id: "sub_1" }]);
    writeContract.mockRejectedValueOnce(new Error("execution reverted"));

    await runKeeper();

    const update = updateCalls[1].set;
    expect(update).toMatchObject({ chargeFailureCount: 1 });
    expect(update.status).toBeUndefined();
    const retryInMs = (update.nextChargeDate as Date).getTime() - Date.now();
    expect(retryInMs).toBeGreaterThan(23 * 60 * 60 * 1000);
  });

  it("rolls the claim back when the subscription's contract is not deployed here", async () => {
    selectResults.push([dueSubscription({ contractAddress: "0xunknown" })]);
    updateReturns.push([{ id: "sub_1" }]);

    await runKeeper();

    expect(writeContract).not.toHaveBeenCalled();
    // Second update restores the original next_charge_date.
    expect(updateCalls[1].set).toMatchObject({ nextChargeDate: DUE_AT });
  });
});
