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

describe("verifyPayment", () => {
  it("GETs /api/payments/:id", async () => {
    const payment = {
      verified: true,
      amount: 1000,
      fee: 5,
      txHash: "0xabc",
      chain: "base-sepolia",
      customerId: "cust-1",
      productId: "prod-1",
      status: "confirmed",
      metadata: {},
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => payment,
    });
    const result = await paylix.verifyPayment({ paymentId: "pay-1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/payments/pay-1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result.verified).toBe(true);
    expect(result.amount).toBe(1000);
    expect(result.status).toBe("confirmed");
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Not Found",
      json: async () => ({ error: "Payment not found" }),
    });
    await expect(paylix.verifyPayment({ paymentId: "bad" })).rejects.toThrow(
      "Paylix verify failed: Payment not found",
    );
  });
});
