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

describe("createProduct", () => {
  it("POSTs to /api/products with correct body", async () => {
    const params = {
      name: "Pro Plan",
      type: "subscription" as const,
      billingInterval: "monthly" as const,
      prices: [{ networkKey: "base-sepolia", tokenSymbol: "USDC", amount: "1000" }],
    };
    const product = { id: "prod-1", ...params, organizationId: "org-1", isActive: true };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => product,
    });
    const result = await paylix.createProduct(params);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/products",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
        body: JSON.stringify(params),
      }),
    );
    expect(result.id).toBe("prod-1");
    expect(result.name).toBe("Pro Plan");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Name is required" } }),
    });
    await expect(
      paylix.createProduct({ name: "", type: "one_time", prices: [] }),
    ).rejects.toThrow("Name is required");
  });
});

describe("getProduct", () => {
  it("GETs /api/products/:id", async () => {
    const product = { id: "prod-1", name: "Pro Plan", type: "subscription" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => product,
    });
    const result = await paylix.getProduct("prod-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/products/prod-1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result.id).toBe("prod-1");
  });

  it("throws on not found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: "Product not found" } }),
    });
    await expect(paylix.getProduct("bad")).rejects.toThrow("Product not found");
  });
});

describe("updateProduct", () => {
  it("PATCHes /api/products/:id", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "prod-1", name: "Pro Plan v2" }),
    });
    const result = await paylix.updateProduct("prod-1", { name: "Pro Plan v2" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/products/prod-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Pro Plan v2" }),
      }),
    );
    expect(result.name).toBe("Pro Plan v2");
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Invalid type" } }),
    });
    await expect(paylix.updateProduct("prod-1", { type: "one_time" })).rejects.toThrow("Invalid type");
  });
});

describe("listProducts", () => {
  it("GETs /api/products", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "prod-1" }, { id: "prod-2" }],
    });
    const result = await paylix.listProducts();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/products",
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
      json: async () => ({ error: { message: "Internal error" } }),
    });
    await expect(paylix.listProducts()).rejects.toThrow("Internal error");
  });
});
