import { describe, it, expect, vi, beforeEach } from "vitest";
import { Paylix } from "../client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const paylix = new Paylix({
  apiKey: "sk_test_123",
  network: "base-sepolia",
  backendUrl: "http://localhost:3000",
  // Deterministic assertions: the retry/backoff path has its own suite in
  // request.test.ts.
  maxRetries: 0,
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

// `getSubscription` was removed in 0.1.0 — `/api/subscriptions/[id]`
// exports only PATCH, so the method returned 405 unconditionally.
// See audit/_requests-sdk.md; it comes back once the GET handler ships.

describe("listSubscriptions status filter", () => {
  it("accepts 'paused', which the database enum emits", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    await paylix.listSubscriptions({ status: "paused" });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("status=paused");
  });
});
