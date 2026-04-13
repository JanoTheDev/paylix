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

describe("listWebhooks", () => {
  it("GETs /api/webhooks", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "wh-1" }, { id: "wh-2" }],
    });
    const result = await paylix.listWebhooks();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/webhooks",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result).toHaveLength(2);
  });
});

describe("createWebhook", () => {
  it("POSTs to /api/webhooks", async () => {
    const params = { url: "https://example.com/hook", events: ["payment.confirmed"] };
    const webhook = { id: "wh-1", ...params, secret: "whsec_abc" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => webhook,
    });
    const result = await paylix.createWebhook(params);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/webhooks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
        body: JSON.stringify(params),
      }),
    );
    expect(result.id).toBe("wh-1");
    expect(result.secret).toBe("whsec_abc");
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Invalid URL" } }),
    });
    await expect(
      paylix.createWebhook({ url: "bad", events: ["payment.confirmed"] }),
    ).rejects.toThrow("Invalid URL");
  });
});

describe("getWebhook", () => {
  it("GETs /api/webhooks/:id", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "wh-1", url: "https://example.com/hook" }),
    });
    const result = await paylix.getWebhook("wh-1");
    expect(result.id).toBe("wh-1");
  });
});

describe("updateWebhook", () => {
  it("PATCHes /api/webhooks/:id", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "wh-1", isActive: false }),
    });
    const result = await paylix.updateWebhook("wh-1", { isActive: false });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/webhooks/wh-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      }),
    );
    expect(result.isActive).toBe(false);
  });
});

describe("deleteWebhook", () => {
  it("DELETEs /api/webhooks/:id", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });
    const result = await paylix.deleteWebhook("wh-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/webhooks/wh-1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_123" }),
      }),
    );
    expect(result.success).toBe(true);
  });

  it("throws on not found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: "Webhook not found" } }),
    });
    await expect(paylix.deleteWebhook("bad")).rejects.toThrow("Webhook not found");
  });
});
