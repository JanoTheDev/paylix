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

describe("createCheckout", () => {
  it("POSTs to /api/checkout with productId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ checkoutUrl: "http://localhost:3000/checkout/abc", checkoutId: "abc" }),
    });
    const result = await paylix.createCheckout({ productId: "prod-1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/checkout",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ productId: "prod-1" }),
      }),
    );
    expect(result.checkoutUrl).toBe("http://localhost:3000/checkout/abc");
    expect(result.checkoutId).toBe("abc");
  });

  it("includes optional params when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ checkoutUrl: "http://localhost:3000/checkout/abc", checkoutId: "abc" }),
    });
    await paylix.createCheckout({
      productId: "prod-1",
      customerId: "cust-1",
      successUrl: "http://example.com/ok",
      cancelUrl: "http://example.com/cancel",
      metadata: { ref: "order-42" },
      networkKey: "base-sepolia",
      tokenSymbol: "USDC",
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.productId).toBe("prod-1");
    expect(body.customerId).toBe("cust-1");
    expect(body.successUrl).toBe("http://example.com/ok");
    expect(body.cancelUrl).toBe("http://example.com/cancel");
    expect(body.metadata).toEqual({ ref: "order-42" });
    expect(body.networkKey).toBe("base-sepolia");
    expect(body.tokenSymbol).toBe("USDC");
  });

  it("throws on API error with error message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Bad Request",
      json: async () => ({ error: "Product not found" }),
    });
    await expect(paylix.createCheckout({ productId: "bad" })).rejects.toThrow(
      "Paylix checkout failed: Product not found",
    );
  });

  it("throws fallback on non-JSON error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Internal Server Error",
      json: async () => { throw new Error("not json"); },
    });
    await expect(paylix.createCheckout({ productId: "x" })).rejects.toThrow(
      "Paylix checkout failed: Request failed",
    );
  });
});
