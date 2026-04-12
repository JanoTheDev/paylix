import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Set up mocks BEFORE importing the route
const writeContract = vi.fn();

// Helper to create a thenable proxy that chains methods
function createChainableProxy<T>(finalResult: T) {
  let result: T = finalResult;

  const handler: ProxyHandler<any> = {
    get(target, prop) {
      if (prop === "then") {
        return (resolve: (v: T) => void) => resolve(result);
      }
      if (prop === Symbol.asyncIterator || prop === Symbol.toStringTag) {
        return undefined;
      }
      if (prop === "__result__") {
        return result;
      }
      return function (...args: any[]) {
        return new Proxy({}, handler);
      };
    },
  };

  return new Proxy({ __result__: finalResult }, handler) as any;
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/relayer", () => ({
  createRelayerClient: () => ({ writeContract }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ ok: true }),
}));
vi.mock("@/lib/contracts", () => ({
  CONTRACTS: {
    subscriptionManager: "0x0000000000000000000000000000000000000123",
    usdc: "0x0000000000000000000000000000000000000456",
    paymentVault: "0x0000000000000000000000000000000000000789",
  },
  PAYMENT_VAULT_ABI: [],
  SUBSCRIPTION_MANAGER_ABI: [],
}));
vi.mock("@/lib/billing-intervals", () => ({
  intervalToSeconds: (interval: string) => {
    const intervals: Record<string, number> = {
      monthly: 2592000,
      yearly: 31536000,
    };
    return intervals[interval] ?? 2592000;
  },
}));
vi.mock("./lock", () => ({
  acquireRelayLock: vi.fn().mockResolvedValue(true),
  releaseRelayLock: vi.fn(),
}));
vi.mock("./validation", () => ({
  parseRelayBody: (body: unknown) => {
    const b = body as any;
    if (
      !b.buyer ||
      !b.deadline ||
      b.v === undefined ||
      !b.r ||
      !b.s ||
      !b.permitValue ||
      !b.intentSignature ||
      !b.networkKey ||
      !b.tokenSymbol
    ) {
      return { ok: false, error: { code: "invalid_body" } };
    }
    return {
      ok: true,
      value: {
        buyer: b.buyer,
        deadline: BigInt(b.deadline),
        v: b.v,
        r: b.r,
        s: b.s,
        permitValue: BigInt(b.permitValue),
        intentSignature: b.intentSignature,
        networkKey: b.networkKey,
        tokenSymbol: b.tokenSymbol,
      },
    };
  },
  validateSessionForRelay: (session: unknown) => {
    if (!session) return { ok: false, error: { code: "session_not_found" } };
    const s = session as any;
    if (s.expiresAt < new Date())
      return { ok: false, error: { code: "session_expired" } };
    if (s.status === "completed")
      return { ok: false, error: { code: "session_not_payable" } };
    if (s.paymentId || s.subscriptionId)
      return { ok: false, error: { code: "session_already_relayed" } };
    return { ok: true };
  },
  validateDeadline: (
    deadline: bigint,
    maxWindowSeconds?: number | undefined
  ) => {
    const now = Math.floor(Date.now() / 1000);
    if (deadline <= BigInt(now))
      return { ok: false, error: { code: "deadline_passed" } };
    return { ok: true };
  },
}));

// Import the route AFTER all mocks are set up
const { POST } = await import("./route");

function makeRequest(body: unknown) {
  return new Request("http://test/api/checkout/sess-1/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  buyer: "0x1111111111111111111111111111111111111111",
  deadline: String(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 16),
  v: 27,
  r: "0x" + "a".repeat(64),
  s: "0x" + "b".repeat(64),
  permitValue: "1000000",
  intentSignature: "0x" + "c".repeat(130),
  networkKey: "base-sepolia",
  tokenSymbol: "USDC",
};

const TRIAL_SESSION = {
  id: "sess-1",
  status: "active",
  expiresAt: new Date(Date.now() + 3600_000),
  paymentId: null,
  subscriptionId: null,
  type: "subscription",
  amount: BigInt("1000000"),
  networkKey: "base-sepolia",
  tokenSymbol: "USDC",
  merchantWallet: "0xmerchantmerchantmerchantmerchantmerchan",
  productId: "prod-1",
  organizationId: "org-1",
  customerId: null,
  buyerCountry: null,
  buyerTaxId: null,
  billingInterval: "monthly",
  trialDays: 14,
};

const CUSTOMER_ROW = {
  id: "cust-123",
  organizationId: "org-1",
  customerId: "cust-id",
  walletAddress: VALID_BODY.buyer,
  country: null,
  taxId: null,
};

const NEW_SUBSCRIPTION = {
  id: "sub-trial-1",
  productId: "prod-1",
  organizationId: "org-1",
  customerId: "cust-123",
  subscriberAddress: VALID_BODY.buyer,
  contractAddress: "0x0000000000000000000000000000000000000123",
  networkKey: "base-sepolia",
  tokenSymbol: "USDC",
  status: "trialing",
  trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  intervalSeconds: 2592000,
  metadata: {},
};

describe("POST /api/checkout/[id]/relay (trial branch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeContract.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should insert a trialing subscription and not call the relayer on trial checkout", async () => {
    // Setup: session load
    const selectFromChain = {
      from: vi.fn(function () {
        return {
          innerJoin: vi.fn(function () {
            return {
              where: vi.fn().mockResolvedValue([TRIAL_SESSION]),
            };
          }),
        };
      }),
    };
    mockDb.select.mockReturnValueOnce(selectFromChain);

    // Setup: 409 guard (no existing trials)
    const selectExistingTrialsChain = {
      from: vi.fn(function () {
        return {
          where: vi.fn(function () {
            return {
              limit: vi.fn().mockResolvedValue([]),
            };
          }),
        };
      }),
    };
    mockDb.select.mockReturnValueOnce(selectExistingTrialsChain);

    // Setup: find customer
    const selectCustomerChain = {
      from: vi.fn(function () {
        return {
          where: vi.fn().mockResolvedValue([]),
        };
      }),
    };
    mockDb.select.mockReturnValueOnce(selectCustomerChain);

    // Setup: insert customer
    const insertCustomerChain = {
      values: vi.fn(function () {
        return {
          returning: vi.fn().mockResolvedValue([CUSTOMER_ROW]),
        };
      }),
    };
    mockDb.insert.mockReturnValueOnce(insertCustomerChain);

    // Setup: insert subscription
    const insertSubChain = {
      values: vi.fn(function (values: any) {
        // Store the values for assertion
        insertSubChain.__insertedValues = values;
        return {
          returning: vi.fn().mockResolvedValue([NEW_SUBSCRIPTION]),
        };
      }),
    };
    mockDb.insert.mockReturnValueOnce(insertSubChain);

    // Setup: update checkout session
    const updateSessionChain = {
      set: vi.fn(function () {
        return {
          where: vi.fn().mockResolvedValue([]),
        };
      }),
    };
    mockDb.update.mockReturnValueOnce(updateSessionChain);

    const res = await POST(makeRequest(VALID_BODY), {
      params: Promise.resolve({ id: "sess-1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.trial).toBe(true);
    expect(json.subscriptionId).toBe(NEW_SUBSCRIPTION.id);
    expect(json.trialEndsAt).toBeDefined();

    // Assert that the subscription was inserted with status "trialing"
    const insertedValues = (insertSubChain as any).__insertedValues;
    expect(insertedValues).toBeDefined();
    expect(insertedValues.status).toBe("trialing");
    expect(insertedValues.pendingPermitSignature).toBeDefined();

    // Assert that writeContract was NOT called
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("should return 409 with code trial_in_progress when wallet has active/trialing subscription", async () => {
    // Setup: session load
    const selectFromChain = {
      from: vi.fn(function () {
        return {
          innerJoin: vi.fn(function () {
            return {
              where: vi.fn().mockResolvedValue([TRIAL_SESSION]),
            };
          }),
        };
      }),
    };
    mockDb.select.mockReturnValueOnce(selectFromChain);

    // Setup: 409 guard returns existing subscription
    const selectExistingTrialsChain = {
      from: vi.fn(function () {
        return {
          where: vi.fn(function () {
            return {
              limit: vi
                .fn()
                .mockResolvedValue([{ id: "existing-sub-1" }]),
            };
          }),
        };
      }),
    };
    mockDb.select.mockReturnValueOnce(selectExistingTrialsChain);

    const res = await POST(makeRequest(VALID_BODY), {
      params: Promise.resolve({ id: "sess-1" }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("trial_in_progress");

    // Assert that writeContract was NOT called
    expect(writeContract).not.toHaveBeenCalled();
  });
});
