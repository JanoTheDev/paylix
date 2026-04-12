import { describe, it, expect, vi, beforeEach } from "vitest";

const MOCK_ORG = { ok: true, organizationId: "org-1", userId: "user-1", session: {} };

vi.mock("@/lib/require-active-org", () => ({
  resolveActiveOrg: vi.fn().mockResolvedValue(MOCK_ORG),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

const mockCustomer = {
  id: "cust-1",
  organizationId: "org-1",
  customerId: "manual_abc123",
  firstName: "Alice",
  lastName: "Smith",
  email: "alice@example.com",
  walletAddress: "0x1234",
  country: null,
  taxId: null,
  phone: null,
  source: "manual",
  metadata: {},
  deletedAt: null,
  createdAt: new Date(),
};

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@/lib/db", () => ({ db: mockDb }));

const { POST: createCustomer } = await import("@/app/api/customers/route");
const { GET: getCustomer, PATCH: updateCustomer } = await import(
  "@/app/api/customers/[id]/route"
);
const { POST: deleteCustomer } = await import(
  "@/app/api/customers/[id]/delete/route"
);

function json(body: unknown) {
  return new Request("http://test/api/customers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Customers API integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a customer", async () => {
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockCustomer]),
      }),
    });
    const res = await createCustomer(json({ firstName: "Alice", email: "alice@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.customer.id).toBe("cust-1");
    expect(body.customer.firstName).toBe("Alice");
  });

  it("rejects customer creation with no identifying fields", async () => {
    const res = await createCustomer(json({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
    expect(typeof body.error.message).toBe("string");
  });

  it("rejects customer creation with invalid email", async () => {
    const res = await createCustomer(json({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("gets a customer with payments and subscriptions", async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockCustomer]),
        }),
      }),
    });
    // payments query
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    // subscriptions query
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    // invoices query
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const res = await getCustomer(
      new Request("http://test/api/customers/cust-1"),
      { params: Promise.resolve({ id: "cust-1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.customer.id).toBe("cust-1");
    expect(Array.isArray(body.payments)).toBe(true);
    expect(Array.isArray(body.subscriptions)).toBe(true);
    expect(Array.isArray(body.invoices)).toBe(true);
  });

  it("returns 404 for nonexistent customer GET", async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const res = await getCustomer(
      new Request("http://test/api/customers/nonexistent"),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(typeof body.error.message).toBe("string");
  });

  it("updates a customer email", async () => {
    mockDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...mockCustomer, email: "new@example.com" }]),
        }),
      }),
    });
    const req = new Request("http://test/api/customers/cust-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.com" }),
    });
    const res = await updateCustomer(req, { params: Promise.resolve({ id: "cust-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.customer.email).toBe("new@example.com");
  });

  it("returns 400 when PATCH has no fields", async () => {
    const req = new Request("http://test/api/customers/cust-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await updateCustomer(req, { params: Promise.resolve({ id: "cust-1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_request");
  });

  it("returns 404 when updating nonexistent customer", async () => {
    mockDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const req = new Request("http://test/api/customers/nope", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@y.com" }),
    });
    const res = await updateCustomer(req, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(typeof body.error.message).toBe("string");
  });

  it("soft-deletes a customer", async () => {
    mockDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "cust-1" }]),
        }),
      }),
    });
    const req = new Request("http://test/api/customers/cust-1/delete", { method: "POST" });
    const res = await deleteCustomer(req, { params: Promise.resolve({ id: "cust-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 404 when soft-deleting nonexistent customer", async () => {
    mockDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const req = new Request("http://test/api/customers/nope/delete", { method: "POST" });
    const res = await deleteCustomer(req, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(typeof body.error.message).toBe("string");
  });
});
