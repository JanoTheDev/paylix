import { describe, it, expect, vi, beforeEach } from "vitest";
import { Paylix } from "../client";
import { PaylixError, isPaylixError } from "../errors";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function client(overrides: Record<string, unknown> = {}) {
  return new Paylix({
    apiKey: "sk_test_123",
    backendUrl: "http://localhost:3000",
    maxRetries: 0,
    ...overrides,
  });
}

function res(init: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  return {
    ok: init.ok ?? false,
    status: init.status ?? 500,
    statusText: init.statusText ?? "",
    headers: {
      get: (k: string) => init.headers?.[k.toLowerCase()] ?? null,
    },
    json: async () => {
      if (init.body === undefined) throw new Error("not json");
      return init.body;
    },
  };
}

beforeEach(() => mockFetch.mockReset());

describe("PaylixError", () => {
  it("carries status, code, body, and requestId", async () => {
    mockFetch.mockResolvedValueOnce(
      res({
        status: 401,
        body: { error: { code: "unauthorized", message: "Authentication required" } },
        headers: { "x-request-id": "req_abc" },
      }),
    );

    const err = await client()
      .listPayments()
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PaylixError);
    expect(isPaylixError(err)).toBe(true);
    const e = err as PaylixError;
    expect(e.name).toBe("PaylixError");
    expect(e.status).toBe(401);
    expect(e.code).toBe("unauthorized");
    expect(e.type).toBe("authentication");
    expect(e.method).toBe("GET");
    expect(e.path).toBe("/api/payments");
    expect(e.requestId).toBe("req_abc");
    expect(e.body).toEqual({
      error: { code: "unauthorized", message: "Authentication required" },
    });
    expect(e.message).toContain("Authentication required");
  });

  it.each([
    [400, "invalid_request"],
    [401, "authentication"],
    [403, "permission"],
    [404, "not_found"],
    [405, "not_found"],
    [429, "rate_limit"],
    [500, "api"],
    [503, "api"],
  ])("maps status %i to type %s", async (status, type) => {
    mockFetch.mockResolvedValue(res({ status, body: { error: "nope" } }));
    const err = (await client()
      .listPayments()
      .catch((e: unknown) => e)) as PaylixError;
    expect(err.type).toBe(type);
  });

  it("parses the { error: string } envelope", async () => {
    mockFetch.mockResolvedValueOnce(res({ status: 400, body: { error: "Product not found" } }));
    const err = (await client()
      .createCheckout({ productId: "x" })
      .catch((e: unknown) => e)) as PaylixError;
    expect(err.message).toContain("Product not found");
  });

  it("parses the { error: { message } } envelope", async () => {
    mockFetch.mockResolvedValueOnce(res({ status: 400, body: { error: { message: "Bad input" } } }));
    const err = (await client()
      .createCheckout({ productId: "x" })
      .catch((e: unknown) => e)) as PaylixError;
    expect(err.message).toContain("Bad input");
  });

  it("falls back to statusText when the body is not JSON", async () => {
    mockFetch.mockResolvedValueOnce(res({ status: 502, statusText: "Bad Gateway" }));
    const err = (await client()
      .listPayments()
      .catch((e: unknown) => e)) as PaylixError;
    expect(err.message).toContain("Bad Gateway");
    expect(err.body).toBeUndefined();
  });

  it("wraps a network failure as a connection error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    const err = (await client()
      .listPayments()
      .catch((e: unknown) => e)) as PaylixError;
    expect(err).toBeInstanceOf(PaylixError);
    expect(err.type).toBe("connection");
    expect(err.status).toBe(0);
    expect(err.message).toContain("fetch failed");
  });

  it("exposes Retry-After on a 429", async () => {
    mockFetch.mockResolvedValueOnce(
      res({ status: 429, body: { error: "slow down" }, headers: { "retry-after": "7" } }),
    );
    const err = (await client()
      .listPayments()
      .catch((e: unknown) => e)) as PaylixError;
    expect(err.type).toBe("rate_limit");
    expect(err.retryAfterSeconds).toBe(7);
  });
});

describe("timeouts", () => {
  it("aborts and throws a timeout error", async () => {
    // Defensive: must not throw synchronously. The test runner also touches
    // the patched global `fetch`, and an exception in the executor would
    // surface as an unhandled rejection unrelated to the SDK.
    mockFetch.mockImplementationOnce((..._args: unknown[]) => {
      const init = _args[1] as { signal?: AbortSignal } | undefined;
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });

    const err = (await client({ timeoutMs: 20 })
      .listPayments()
      .catch((e: unknown) => e)) as PaylixError;
    expect(err.type).toBe("timeout");
    expect(err.code).toBe("timeout");
    expect(err.message).toContain("20ms");
  });

  it("passes an AbortSignal on every request", async () => {
    mockFetch.mockResolvedValueOnce(res({ ok: true, status: 200, body: [] }));
    await client().listPayments();
    expect(mockFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("retries", () => {
  it("retries a 500 on a GET and returns the eventual success", async () => {
    mockFetch
      .mockResolvedValueOnce(res({ status: 500, body: { error: "boom" } }))
      .mockResolvedValueOnce(res({ ok: true, status: 200, body: [{ id: "pay-1" }] }));

    const result = await client({ maxRetries: 2 }).listPayments();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
  });

  it("retries network errors on a GET", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("ECONNRESET"))
      .mockResolvedValueOnce(res({ ok: true, status: 200, body: [] }));

    await client({ maxRetries: 1 }).listPayments();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries and throws the last error", async () => {
    mockFetch.mockResolvedValue(res({ status: 503, body: { error: "unavailable" } }));
    const err = (await client({ maxRetries: 2 })
      .listPayments()
      .catch((e: unknown) => e)) as PaylixError;
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(err.status).toBe(503);
  });

  it("does not retry a 400", async () => {
    mockFetch.mockResolvedValue(res({ status: 400, body: { error: "bad" } }));
    await client({ maxRetries: 3 })
      .listPayments()
      .catch(() => undefined);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 even on a POST", async () => {
    mockFetch
      .mockResolvedValueOnce(res({ status: 429, body: { error: "rate limited" } }))
      .mockResolvedValueOnce(
        res({ ok: true, status: 200, body: { checkoutUrl: "u", checkoutId: "c" } }),
      );

    const out = await client({ maxRetries: 1 }).createCheckout({ productId: "p" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(out.checkoutId).toBe("c");
  });
});

describe("idempotency keys", () => {
  it("sends one on POST and reuses it across retries", async () => {
    mockFetch
      .mockResolvedValueOnce(res({ status: 500, body: { error: "boom" } }))
      .mockResolvedValueOnce(
        res({ ok: true, status: 200, body: { checkoutUrl: "u", checkoutId: "c" } }),
      );

    await client({ maxRetries: 1 }).createCheckout({ productId: "p" });

    const first = mockFetch.mock.calls[0][1].headers["Idempotency-Key"];
    const second = mockFetch.mock.calls[1][1].headers["Idempotency-Key"];
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("does not send one on GET", async () => {
    mockFetch.mockResolvedValueOnce(res({ ok: true, status: 200, body: [] }));
    await client().listPayments();
    expect(mockFetch.mock.calls[0][1].headers["Idempotency-Key"]).toBeUndefined();
  });

  it("generates a distinct key per POST", async () => {
    mockFetch.mockResolvedValue(
      res({ ok: true, status: 200, body: { checkoutUrl: "u", checkoutId: "c" } }),
    );
    const p = client();
    await p.createCheckout({ productId: "a" });
    await p.createCheckout({ productId: "b" });
    expect(mockFetch.mock.calls[0][1].headers["Idempotency-Key"]).not.toBe(
      mockFetch.mock.calls[1][1].headers["Idempotency-Key"],
    );
  });
});

describe("config plumbing", () => {
  it("uses an injected fetch instead of the global", async () => {
    const injected = vi.fn().mockResolvedValue(res({ ok: true, status: 200, body: [] }));
    const paylix = new Paylix({
      apiKey: "sk_test_1",
      backendUrl: "http://localhost:3000",
      fetch: injected as unknown as typeof fetch,
    });
    await paylix.listPayments();
    expect(injected).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("normalizes a trailing slash on backendUrl", async () => {
    const injected = vi.fn().mockResolvedValue(res({ ok: true, status: 200, body: [] }));
    const paylix = new Paylix({
      apiKey: "sk_test_1",
      backendUrl: "http://localhost:3000/",
      fetch: injected as unknown as typeof fetch,
    });
    await paylix.listPayments();
    expect(injected.mock.calls[0][0]).toBe("http://localhost:3000/api/payments");
  });

  it("omits Content-Type on bodyless requests", async () => {
    mockFetch.mockResolvedValueOnce(res({ ok: true, status: 200, body: {} }));
    await client().cancelSubscription({ subscriptionId: "sub-1" });
    expect(mockFetch.mock.calls[0][1].headers["Content-Type"]).toBeUndefined();
  });
});
