import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Set up mocks BEFORE importing the route
const writeContract = vi.fn();
const checkExistingSubscriptionMock = vi.fn();

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

const mockDeployment = {
  network: { key: "base-sepolia", chainId: 84532 },
  chain: { id: 84532 },
  chainId: 84532,
  rpcUrl: "https://test.example",
  paymentVault: "0x0000000000000000000000000000000000000789" as `0x${string}`,
  subscriptionManager: "0x0000000000000000000000000000000000000123" as `0x${string}`,
  usdcAddress: "0x0000000000000000000000000000000000000456" as `0x${string}`,
};

// Resolve MockUSDC address for base-sepolia token lookups. Without this env
// the relay route throws when resolving the token address from the registry.
process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS = "0x0000000000000000000000000000000000000456";
process.env.NEXT_PUBLIC_NETWORK = "base-sepolia";

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/blocklist-load", () => ({
  loadOrgBlocklist: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/relayer", () => ({
  createRelayerClient: () => ({ writeContract }),
}));
vi.mock("@/lib/deployment", () => ({
  resolveDeploymentForMode: vi.fn(() => mockDeployment),
}));
vi.mock("./dedup", () => ({
  checkExistingSubscription: (...args: unknown[]) => checkExistingSubscriptionMock(...args),
}));
vi.mock("@/lib/wallet-activity", () => ({
  checkWalletActivity: vi.fn().mockResolvedValue({ active: true }),
}));
vi.mock("@/lib/webhook-dispatch", () => ({
  dispatchWebhooks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ ok: true }),
  checkRateLimitAsync: () => Promise.resolve({ ok: true }),
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
    const b = body as Record<string, unknown>;
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
        buyer: b.buyer as string,
        deadline: BigInt(b.deadline as string | number),
        v: b.v as number,
        r: b.r as string,
        s: b.s as string,
        permitValue: BigInt(b.permitValue as string | number),
        intentSignature: b.intentSignature as string,
        networkKey: b.networkKey as string,
        tokenSymbol: b.tokenSymbol as string,
      },
    };
  },
  validateSessionForRelay: (session: unknown) => {
    if (!session) return { ok: false, error: { code: "session_not_found" } };
    const s = session as {
      expiresAt: Date;
      status: string;
      paymentId: string | null;
      subscriptionId: string | null;
    };
    if (s.expiresAt < new Date())
      return { ok: false, error: { code: "session_expired" } };
    if (s.status === "completed")
      return { ok: false, error: { code: "session_not_payable" } };
    if (s.paymentId || s.subscriptionId)
      return { ok: false, error: { code: "session_already_relayed" } };
    return { ok: true };
  },
  validateDeadline: (deadline: bigint) => {
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
  buyerFirstName: null,
  buyerLastName: null,
  buyerEmail: "buyer@example.com",
  buyerPhone: null,
  billingInterval: "monthly",
  trialDays: 14,
  trialMinutes: 0,
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
    checkExistingSubscriptionMock.mockResolvedValue({ exists: false });
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

    // checkExistingSubscription is mocked at module level (returns { exists: false })

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
    const insertSubChain: { values: ReturnType<typeof vi.fn>; __insertedValues?: unknown } = {
      values: vi.fn(function (values: unknown) {
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
    const insertedValues = insertSubChain.__insertedValues as
      | { status?: string; pendingPermitSignature?: unknown }
      | undefined;
    expect(insertedValues).toBeDefined();
    expect(insertedValues?.status).toBe("trialing");
    expect(insertedValues?.pendingPermitSignature).toBeDefined();

    // Assert that writeContract was NOT called
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("should return 409 with code duplicate_subscription when wallet has active/trialing subscription on the product", async () => {
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

    // Trial dedup: hits (wallet has active sub) → auto-fallback, then
    // subscription-intent dedup also hits → final 409.
    checkExistingSubscriptionMock
      .mockResolvedValueOnce({ exists: true })  // trial dedup → fallback
      .mockResolvedValueOnce({ exists: true }); // subscription dedup → 409

    const res = await POST(makeRequest(VALID_BODY), {
      params: Promise.resolve({ id: "sess-1" }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("duplicate_subscription");

    // Assert that writeContract was NOT called
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("blocks duplicate subscription by customer id when wallet differs", async () => {
    const sessionWithCustomer = { ...TRIAL_SESSION, customerId: "cust-id" };

    const selectFromChain = {
      from: vi.fn(function () {
        return {
          innerJoin: vi.fn(function () {
            return {
              where: vi.fn().mockResolvedValue([sessionWithCustomer]),
            };
          }),
        };
      }),
    };
    mockDb.select.mockReturnValueOnce(selectFromChain);

    // Trial dedup: hits by customer_id → fallback; subscription dedup: also hits → 409.
    checkExistingSubscriptionMock
      .mockResolvedValueOnce({ exists: true })  // trial dedup → fallback
      .mockResolvedValueOnce({ exists: true }); // subscription dedup → 409

    const res = await POST(makeRequest(VALID_BODY), {
      params: Promise.resolve({ id: "sess-1" }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("duplicate_subscription");
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("blocks duplicate subscription by email when customer_id differs", async () => {
    const sessionWithCustomer = { ...TRIAL_SESSION, customerId: "cust-id" };

    const selectFromChain = {
      from: vi.fn(function () {
        return {
          innerJoin: vi.fn(function () {
            return {
              where: vi.fn().mockResolvedValue([sessionWithCustomer]),
            };
          }),
        };
      }),
    };
    mockDb.select.mockReturnValueOnce(selectFromChain);

    // Trial dedup: hits by email → fallback; subscription dedup: also hits → 409.
    checkExistingSubscriptionMock
      .mockResolvedValueOnce({ exists: true })  // trial dedup → fallback
      .mockResolvedValueOnce({ exists: true }); // subscription dedup → 409

    const res = await POST(makeRequest(VALID_BODY), {
      params: Promise.resolve({ id: "sess-1" }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("duplicate_subscription");
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("falls back to paid subscription when customer previously used the trial", async () => {
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

    // First dedup (trial intent) returns a cancelled row — triggers fallback.
    // Second dedup (subscription intent) — no active sub, fallback proceeds.
    checkExistingSubscriptionMock
      .mockResolvedValueOnce({ exists: true })   // trial dedup → fallback (was cancelled)
      .mockResolvedValueOnce({ exists: false });  // subscription dedup → no duplicate, proceed

    const fakeTxHash =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    writeContract.mockResolvedValueOnce(fakeTxHash);

    const res = await POST(makeRequest(VALID_BODY), {
      params: Promise.resolve({ id: "sess-1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.txHash).toBe(fakeTxHash);
    expect(json.trial).toBeUndefined();

    // The paid subscription path called the contract.
    expect(writeContract).toHaveBeenCalledTimes(1);
    const call = writeContract.mock.calls[0][0];
    expect(call.functionName).toBe("createSubscriptionWithPermit");
  });

  it("allows different customer on same product (no duplicate)", async () => {
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

    // Dedup: no existing subscription (default mock returns { exists: false })

    // find customer by (org, identifier) — empty so new customer is inserted
    const selectCustomerChain = {
      from: vi.fn(function () {
        return {
          where: vi.fn().mockResolvedValue([]),
        };
      }),
    };
    mockDb.select.mockReturnValueOnce(selectCustomerChain);

    const insertCustomerChain = {
      values: vi.fn(function () {
        return {
          returning: vi.fn().mockResolvedValue([CUSTOMER_ROW]),
        };
      }),
    };
    mockDb.insert.mockReturnValueOnce(insertCustomerChain);

    const insertSubChain = {
      values: vi.fn(function () {
        return {
          returning: vi.fn().mockResolvedValue([NEW_SUBSCRIPTION]),
        };
      }),
    };
    mockDb.insert.mockReturnValueOnce(insertSubChain);

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
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("rejects trial checkout with no email", async () => {
    const noEmailSession = { ...TRIAL_SESSION, buyerEmail: null };
    const selectFromChain = {
      from: vi.fn(function () {
        return {
          innerJoin: vi.fn(function () {
            return {
              where: vi.fn().mockResolvedValue([noEmailSession]),
            };
          }),
        };
      }),
    };
    mockDb.select.mockReturnValueOnce(selectFromChain);

    const res = await POST(makeRequest(VALID_BODY), {
      params: Promise.resolve({ id: "sess-1" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("email_required");
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("rejects trial checkout with disposable email", async () => {
    const disposableSession = {
      ...TRIAL_SESSION,
      buyerEmail: "abuser@mailinator.com",
    };
    const selectFromChain = {
      from: vi.fn(function () {
        return {
          innerJoin: vi.fn(function () {
            return {
              where: vi.fn().mockResolvedValue([disposableSession]),
            };
          }),
        };
      }),
    };
    mockDb.select.mockReturnValueOnce(selectFromChain);

    const res = await POST(makeRequest(VALID_BODY), {
      params: Promise.resolve({ id: "sess-1" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("disposable_email");
    expect(writeContract).not.toHaveBeenCalled();
  });
});
