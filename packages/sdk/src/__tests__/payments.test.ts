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

describe("listPayments", () => {
  it("GETs /api/payments with no filters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "pay-1" }, { id: "pay-2" }],
    });
    const result = await paylix.listPayments();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/payments",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result).toHaveLength(2);
  });

  it("filters by customerId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "pay-1" }],
    });
    await paylix.listPayments({ customerId: "cust_xyz" });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("customerId=cust_xyz");
  });

  it("filters by status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    await paylix.listPayments({ status: "confirmed" });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("status=confirmed");
  });

  it("filters by metadata", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "pay-1" }],
    });
    await paylix.listPayments({ metadata: { userId: "u_123", orderId: "42" } });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("metadata%5BuserId%5D=u_123");
    expect(calledUrl).toContain("metadata%5BorderId%5D=42");
  });

  it("passes limit", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    await paylix.listPayments({ limit: 10 });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=10");
  });

  it("combines multiple filters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    await paylix.listPayments({
      customerId: "cust_abc",
      status: "confirmed",
      metadata: { plan: "pro" },
      limit: 25,
    });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("customerId=cust_abc");
    expect(calledUrl).toContain("status=confirmed");
    expect(calledUrl).toContain("metadata%5Bplan%5D=pro");
    expect(calledUrl).toContain("limit=25");
  });

  it("returns customer info in response", async () => {
    const payment = {
      id: "pay-1",
      amount: 1000,
      status: "confirmed",
      customer: {
        id: "cust_xyz",
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Smith",
        walletAddress: "0xabc",
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [payment],
    });
    const [result] = await paylix.listPayments();
    expect(result.customer.email).toBe("alice@example.com");
    expect(result.customer.firstName).toBe("Alice");
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Internal error" } }),
    });
    await expect(paylix.listPayments()).rejects.toThrow("Internal error");
  });
});

describe("getPayment", () => {
  it("GETs /api/payments/:id", async () => {
    const payment = { id: "pay-1", amount: 1000, status: "confirmed" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => payment,
    });
    const result = await paylix.getPayment("pay-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/payments/pay-1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result.id).toBe("pay-1");
  });

  it("throws on not found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: "Payment not found" } }),
    });
    await expect(paylix.getPayment("bad")).rejects.toThrow("Payment not found");
  });
});
