import { describe, it, expect, vi, beforeEach } from "vitest";
import { Paylix } from "../client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const paylix = new Paylix({
  apiKey: "sk_test_123",
  network: "base-sepolia",
  backendUrl: "http://localhost:3000",
});

beforeEach(() => mockFetch.mockReset());

describe("createCustomer", () => {
  it("POSTs to /api/customers with correct body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ customer: { id: "cust-1", customerId: "user_123", email: "a@b.com" } }),
    });
    const result = await paylix.createCustomer({ email: "a@b.com", firstName: "Alice" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/customers",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
        body: JSON.stringify({ email: "a@b.com", firstName: "Alice" }),
      }),
    );
    expect(result).toEqual({ id: "cust-1", customerId: "user_123", email: "a@b.com" });
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Invalid input" } }),
    });
    await expect(paylix.createCustomer({ email: "x" })).rejects.toThrow("Invalid input");
  });

  it("throws fallback message when error body has no message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error("not json"); },
    });
    await expect(paylix.createCustomer({})).rejects.toThrow("Failed to create customer (500)");
  });
});

describe("getCustomer", () => {
  it("GETs /api/customers/:id", async () => {
    const detail = { customer: { id: "cust-1", customerId: "user_123" }, payments: [], subscriptions: [], invoices: [] };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => detail,
    });
    const result = await paylix.getCustomer("cust-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/customers/cust-1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result.customer.id).toBe("cust-1");
  });

  it("throws on not found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: "Not found" } }),
    });
    await expect(paylix.getCustomer("bad-id")).rejects.toThrow("Not found");
  });
});

describe("updateCustomer", () => {
  it("PATCHes /api/customers/:id", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ customer: { id: "cust-1", email: "new@b.com" } }),
    });
    const result = await paylix.updateCustomer("cust-1", { email: "new@b.com" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/customers/cust-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ email: "new@b.com" }),
      }),
    );
    expect(result.email).toBe("new@b.com");
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Bad data" } }),
    });
    await expect(paylix.updateCustomer("cust-1", { email: "x" })).rejects.toThrow("Bad data");
  });
});

describe("listCustomers", () => {
  it("GETs /api/customers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "cust-1" }, { id: "cust-2" }],
    });
    const result = await paylix.listCustomers();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/customers",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result).toHaveLength(2);
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Server error" } }),
    });
    await expect(paylix.listCustomers()).rejects.toThrow("Server error");
  });
});

describe("deleteCustomer", () => {
  it("POSTs to /api/customers/:id/delete", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    const result = await paylix.deleteCustomer("cust-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/customers/cust-1/delete",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.ok).toBe(true);
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: "Customer not found" } }),
    });
    await expect(paylix.deleteCustomer("bad")).rejects.toThrow("Customer not found");
  });
});
