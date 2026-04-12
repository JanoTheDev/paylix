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

describe("createSubscription", () => {
  it("POSTs to /api/checkout with type subscription", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ checkoutUrl: "http://localhost:3000/checkout/sub1", checkoutId: "sub1" }),
    });
    const result = await paylix.createSubscription({ productId: "prod-sub" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/checkout",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ productId: "prod-sub", type: "subscription" }),
      }),
    );
    expect(result.checkoutUrl).toBe("http://localhost:3000/checkout/sub1");
    expect(result.checkoutId).toBe("sub1");
    expect(result.trialEndsAt).toBeNull();
  });

  it("returns trialEndsAt when present", async () => {
    const trialDate = "2026-05-01T00:00:00.000Z";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ checkoutUrl: "http://localhost:3000/checkout/sub2", checkoutId: "sub2", trialEndsAt: trialDate }),
    });
    const result = await paylix.createSubscription({ productId: "prod-trial" });
    expect(result.trialEndsAt).toBe(trialDate);
  });

  it("includes optional params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ checkoutUrl: "url", checkoutId: "id" }),
    });
    await paylix.createSubscription({
      productId: "prod-1",
      customerId: "cust-1",
      successUrl: "http://ok.com",
      cancelUrl: "http://cancel.com",
      metadata: { plan: "pro" },
      networkKey: "base-sepolia",
      tokenSymbol: "USDC",
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.type).toBe("subscription");
    expect(body.customerId).toBe("cust-1");
    expect(body.metadata).toEqual({ plan: "pro" });
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Bad Request",
      json: async () => ({ error: "Invalid product" }),
    });
    await expect(paylix.createSubscription({ productId: "bad" })).rejects.toThrow(
      "Paylix subscription failed: Invalid product",
    );
  });
});

describe("cancelSubscription", () => {
  it("POSTs to /api/subscriptions/:id/cancel-gasless", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await paylix.cancelSubscription({ subscriptionId: "sub-123" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/subscriptions/sub-123/cancel-gasless",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Not Found",
      json: async () => ({ error: "Subscription not found" }),
    });
    await expect(paylix.cancelSubscription({ subscriptionId: "bad" })).rejects.toThrow(
      "Paylix cancel failed: Subscription not found",
    );
  });
});

describe("updateSubscriptionWallet", () => {
  it("POSTs to /api/subscriptions/:id/update-wallet", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await paylix.updateSubscriptionWallet({
      subscriptionId: "sub-123",
      newWallet: "0xNewWallet",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/subscriptions/sub-123/update-wallet",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ newWallet: "0xNewWallet" }),
      }),
    );
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Bad Request",
      json: async () => ({ error: "Invalid wallet address" }),
    });
    await expect(
      paylix.updateSubscriptionWallet({ subscriptionId: "sub-1", newWallet: "bad" }),
    ).rejects.toThrow("Paylix wallet update failed: Invalid wallet address");
  });
});
