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

describe("getCustomerPortal", () => {
  it("GETs /api/customers/:customerId", async () => {
    const portalData = {
      customer: { id: "cust-1", customerId: "user_123", email: "a@b.com" },
      payments: [{ id: "pay-1", amount: 1000, status: "confirmed" }],
      subscriptions: [],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => portalData,
    });
    const result = await paylix.getCustomerPortal({ customerId: "cust-1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/customers/cust-1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result.customer.id).toBe("cust-1");
    expect(result.payments).toHaveLength(1);
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Not Found",
      json: async () => ({ error: "Customer not found" }),
    });
    await expect(paylix.getCustomerPortal({ customerId: "bad" })).rejects.toThrow(
      "Paylix portal failed: Customer not found",
    );
  });
});
