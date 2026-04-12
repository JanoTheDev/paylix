import { describe, it, expect, vi, beforeEach } from "vitest";

const MOCK_ORG = { ok: true, organizationId: "org-1", userId: "user-1", session: {} };

vi.mock("@/lib/require-active-org", () => ({
  resolveActiveOrg: vi.fn().mockResolvedValue(MOCK_ORG),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

const mockProduct = {
  id: "prod-1",
  organizationId: "org-1",
  name: "Pro Plan",
  type: "subscription",
  billingInterval: "monthly",
  description: null,
  metadata: {},
  checkoutFields: {},
  isActive: true,
  trialDays: null,
  trialMinutes: null,
  taxRateBps: null,
  taxLabel: null,
  reverseChargeEligible: false,
  createdAt: new Date(),
};

const mockPrice = {
  id: "price-1",
  productId: "prod-1",
  networkKey: "base-sepolia",
  tokenSymbol: "USDC",
  amount: BigInt("1000000"),
  isActive: true,
};

let txInsertedValues: unknown[] = [];
let txUpdatePatch: unknown = null;
let txSelectReturn: unknown[] = [];

const mockTx = {
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockImplementation((vals: unknown) => {
      txInsertedValues.push(vals);
      return { returning: vi.fn().mockResolvedValue([mockProduct]) };
    }),
  }),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockImplementation((patch: unknown) => {
      txUpdatePatch = patch;
      return {
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockProduct]),
        }),
      };
    }),
  }),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        return Promise.resolve(txSelectReturn);
      }),
    }),
  }),
};

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn().mockImplementation((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@paylix/config/networks", () => ({
  NETWORKS: {
    "base-sepolia": { tokens: { USDC: { address: "0x", decimals: 6 } } },
  },
  assertValidNetworkKey: vi.fn(),
  assertValidTokenSymbol: vi.fn(),
}));

const { GET: listProducts, POST: createProduct } = await import(
  "@/app/api/products/route"
);
const { PATCH: updateProduct, DELETE: deleteProduct } = await import(
  "@/app/api/products/[id]/route"
);

function json(body: unknown, method = "POST") {
  return new Request("http://test/api/products", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Products API integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txInsertedValues = [];
    txUpdatePatch = null;
    txSelectReturn = [mockProduct];
  });

  it("creates a product with prices and returns 201", async () => {
    const res = await createProduct(
      json({
        name: "Pro Plan",
        type: "subscription",
        billingInterval: "monthly",
        prices: [{ networkKey: "base-sepolia", tokenSymbol: "USDC", amount: "1000000" }],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("prod-1");
    expect(body.name).toBe("Pro Plan");
  });

  it("updates a product via PATCH", async () => {
    const req = new Request("http://test/api/products/prod-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Updated Plan" }),
    });
    const res = await updateProduct(req, { params: Promise.resolve({ id: "prod-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("prod-1");
  });

  it("returns 404 when updating a nonexistent product", async () => {
    txSelectReturn = [];
    mockTx.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    mockDb.transaction.mockImplementationOnce(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      const localTx = {
        ...mockTx,
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
      return fn(localTx as unknown as typeof mockTx);
    });
    const req = new Request("http://test/api/products/nonexistent", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    const res = await updateProduct(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBeDefined();
  });

  it("lists products for the org", async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([mockProduct]),
        }),
      }),
    });
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockPrice]),
      }),
    });
    const res = await listProducts();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].id).toBe("prod-1");
    expect(body[0].prices).toBeDefined();
  });

  it("rejects invalid product type with validation_failed", async () => {
    const res = await createProduct(
      json({
        name: "Bad",
        type: "invalid",
        prices: [{ networkKey: "base-sepolia", tokenSymbol: "USDC", amount: "1000" }],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
    expect(typeof body.error.message).toBe("string");
  });

  it("rejects subscription without billingInterval", async () => {
    const res = await createProduct(
      json({
        name: "Missing interval",
        type: "subscription",
        prices: [{ networkKey: "base-sepolia", tokenSymbol: "USDC", amount: "1000" }],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("forces email collection on trial products", async () => {
    const trialProduct = {
      ...mockProduct,
      trialDays: 14,
      checkoutFields: { email: true },
    };
    mockDb.transaction.mockImplementationOnce(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      const localTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation(() => ({
            returning: vi.fn().mockResolvedValue([trialProduct]),
          })),
        }),
      };
      return fn(localTx as unknown as typeof mockTx);
    });
    const res = await createProduct(
      json({
        name: "Trial Plan",
        type: "subscription",
        billingInterval: "monthly",
        trialDays: 14,
        prices: [{ networkKey: "base-sepolia", tokenSymbol: "USDC", amount: "1000" }],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.checkoutFields.email).toBe(true);
  });

  it("deletes (deactivates) a product", async () => {
    mockDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...mockProduct, isActive: false }]),
        }),
      }),
    });
    const req = new Request("http://test/api/products/prod-1", { method: "DELETE" });
    const res = await deleteProduct(req, { params: Promise.resolve({ id: "prod-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 404 when deleting nonexistent product", async () => {
    mockDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const req = new Request("http://test/api/products/nope", { method: "DELETE" });
    const res = await deleteProduct(req, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBeDefined();
  });
});
