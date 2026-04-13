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

describe("listSubscriptions", () => {
  it("GETs /api/subscriptions with no filters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "sub-1" }, { id: "sub-2" }],
    });
    const result = await paylix.listSubscriptions();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/subscriptions",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result).toHaveLength(2);
  });

  it("filters by customerId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "sub-1" }],
    });
    await paylix.listSubscriptions({ customerId: "cust_xyz" });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("customerId=cust_xyz");
  });

  it("filters by status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    await paylix.listSubscriptions({ status: "active" });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("status=active");
  });

  it("filters by metadata", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "sub-1" }],
    });
    await paylix.listSubscriptions({ metadata: { userId: "u_123" } });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("metadata%5BuserId%5D=u_123");
  });

  it("returns customer info in response", async () => {
    const sub = {
      id: "sub-1",
      status: "active",
      customer: {
        id: "cust_xyz",
        email: "bob@example.com",
        firstName: "Bob",
        lastName: null,
        walletAddress: "0xdef",
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [sub],
    });
    const [result] = await paylix.listSubscriptions();
    expect(result.customer.email).toBe("bob@example.com");
    expect(result.customer.id).toBe("cust_xyz");
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Internal error" } }),
    });
    await expect(paylix.listSubscriptions()).rejects.toThrow("Internal error");
  });
});

describe("getSubscription", () => {
  it("GETs /api/subscriptions/:id", async () => {
    const sub = { id: "sub-1", status: "active", productName: "Pro" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sub,
    });
    const result = await paylix.getSubscription("sub-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/subscriptions/sub-1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result.id).toBe("sub-1");
  });

  it("throws on not found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: "Subscription not found" } }),
    });
    await expect(paylix.getSubscription("bad")).rejects.toThrow("Subscription not found");
  });
});
