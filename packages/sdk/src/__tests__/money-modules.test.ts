import { describe, it, expect, vi, beforeEach } from "vitest";
import { Paylix } from "../client";
import type { PaylixError } from "../errors";

/**
 * Coverage for the modules SDK-15 flagged as untested — every method here
 * either moves money, forgives money, or changes who can pay.
 */

const mockFetch = vi.fn();
global.fetch = mockFetch;

const paylix = new Paylix({
  apiKey: "sk_test_123",
  backendUrl: "http://localhost:3000",
  maxRetries: 0,
});

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function fail(status: number, body: unknown) {
  return { ok: false, status, statusText: "", json: async () => body };
}

/**
 * A `fetch` stand-in that never settles until its `AbortSignal` fires,
 * mirroring what a real hung connection does. Written defensively — it
 * must not throw synchronously, because the test runner itself touches
 * the patched global `fetch` after a test ends and an exception raised in
 * the executor would surface as an unhandled rejection.
 */
function hangUntilAborted(..._args: unknown[]): Promise<never> {
  const init = _args[1] as { signal?: AbortSignal } | undefined;
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // not a call we made; leave it pending
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort);
  });
}

function call(index = 0) {
  const [url, init] = mockFetch.mock.calls[index];
  return {
    url: url as string,
    method: init.method as string | undefined,
    body: init.body ? JSON.parse(init.body as string) : undefined,
    headers: init.headers as Record<string, string>,
  };
}

beforeEach(() => mockFetch.mockReset());

describe("refundPayment", () => {
  it("POSTs to /api/payments/:id/refund without the id in the body", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "ref-1", amount: 500, status: "pending" }));
    const refund = await paylix.refundPayment({
      paymentId: "pay-1",
      amount: 500,
      txHash: "0xabc",
      reason: "duplicate",
    });
    expect(call().url).toBe("http://localhost:3000/api/payments/pay-1/refund");
    expect(call().method).toBe("POST");
    expect(call().body).toEqual({ amount: 500, txHash: "0xabc", reason: "duplicate" });
    expect(refund.id).toBe("ref-1");
  });

  it("surfaces the server's validation message", async () => {
    mockFetch.mockResolvedValueOnce(
      fail(400, { error: { message: "Refund exceeds remaining balance" } }),
    );
    await expect(
      paylix.refundPayment({ paymentId: "pay-1", amount: 999999, txHash: "0x" }),
    ).rejects.toThrow("Refund exceeds remaining balance");
  });
});

describe("admin trial operations", () => {
  it("extendTrial POSTs days", async () => {
    mockFetch.mockResolvedValueOnce(ok({ success: true, trialEndsAt: "2026-08-01T00:00:00Z" }));
    const out = await paylix.extendTrial("sub-1", 7);
    expect(call().url).toBe("http://localhost:3000/api/subscriptions/sub-1/extend-trial");
    expect(call().body).toEqual({ days: 7 });
    expect(out.trialEndsAt).toBe("2026-08-01T00:00:00Z");
  });

  it("compCharge POSTs with no body", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({ success: true, paymentId: "pay-9", nextChargeDate: "2026-09-01T00:00:00Z" }),
    );
    const out = await paylix.compCharge("sub-1");
    expect(call().url).toBe("http://localhost:3000/api/subscriptions/sub-1/comp-charge");
    expect(call().method).toBe("POST");
    expect(call().body).toBeUndefined();
    expect(out.paymentId).toBe("pay-9");
  });

  it("rescheduleSubscription POSTs the new date", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({ success: true, nextChargeDate: "2026-10-01T00:00:00Z" }),
    );
    await paylix.rescheduleSubscription("sub-1", "2026-10-01T00:00:00Z");
    expect(call().body).toEqual({ nextChargeDate: "2026-10-01T00:00:00Z" });
  });

  it("throws a typed error when the subscription is not trialing", async () => {
    mockFetch.mockResolvedValueOnce(fail(409, { error: { code: "conflict", message: "Not trialing" } }));
    const err = (await paylix.extendTrial("sub-1", 1).catch((e) => e)) as PaylixError;
    expect(err.status).toBe(409);
    expect(err.code).toBe("conflict");
    expect(err.type).toBe("invalid_request");
  });
});

/**
 * These three routes ignore `Idempotency-Key` server-side and their effects
 * accumulate, so a replay grants a second trial extension / comps a second
 * period. They must never be retried, regardless of client config.
 */
describe("accumulative admin routes are never retried", () => {
  /**
   * These cases inject `fetch` through `PaylixConfig` rather than patching
   * the global. Patching the global for a mock that hangs or throws also
   * catches the test runner's own internal `fetch` traffic, which showed up
   * as unhandled rejections and hook timeouts unrelated to the SDK.
   */
  function retryHappy(impl: (...args: any[]) => Promise<any>, timeoutMs?: number) {
    const spy = vi.fn(impl);
    const paylix = new Paylix({
      apiKey: "sk_test_123",
      backendUrl: "http://localhost:3000",
      maxRetries: 5, // deliberately aggressive; these calls must ignore it
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      fetch: spy as unknown as typeof fetch,
    });
    return { paylix, spy };
  }

  const cases: Array<[string, (p: Paylix) => Promise<unknown>]> = [
    ["extendTrial", (p) => p.extendTrial("sub-1", 7)],
    ["compCharge", (p) => p.compCharge("sub-1")],
    ["rescheduleSubscription", (p) => p.rescheduleSubscription("sub-1", "2026-10-01T00:00:00Z")],
  ];

  it.each(cases)("%s does not retry a 500", async (_name, invoke) => {
    const { paylix, spy } = retryHappy(async () => fail(500, { error: "boom" }));
    await invoke(paylix).catch(() => undefined);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(cases)("%s does not retry a 429", async (_name, invoke) => {
    const { paylix, spy } = retryHappy(async () => fail(429, { error: "rate limited" }));
    await invoke(paylix).catch(() => undefined);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(cases)("%s does not retry a dropped connection", async (_name, invoke) => {
    // The dangerous case: the mutation may already have been applied and
    // only the response was lost.
    const { paylix, spy } = retryHappy(() => Promise.reject(new TypeError("ECONNRESET")));
    const err = (await invoke(paylix).catch((e) => e)) as PaylixError;
    expect(err.type).toBe("connection");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(cases)("%s does not retry a timeout", async (_name, invoke) => {
    // Equally dangerous: the server may have applied the mutation and
    // simply taken longer than timeoutMs to answer.
    const { paylix, spy } = retryHappy(hangUntilAborted, 20);
    const err = (await invoke(paylix).catch((e) => e)) as PaylixError;
    expect(err.type).toBe("timeout");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(cases)("%s sends no Idempotency-Key it cannot honour", async (_name, invoke) => {
    const { paylix, spy } = retryHappy(async () => ok({ success: true }));
    await invoke(paylix);
    expect(spy.mock.calls[0][1].headers["Idempotency-Key"]).toBeUndefined();
  });

  it("still surfaces the error to the caller rather than swallowing it", async () => {
    const { paylix } = retryHappy(async () => fail(500, { error: "boom" }));
    await expect(paylix.compCharge("sub-1")).rejects.toThrow("boom");
  });

  it("leaves other POSTs retryable — this is a targeted veto, not a global one", async () => {
    let n = 0;
    const { paylix, spy } = retryHappy(async () =>
      ++n === 1 ? fail(500, { error: "boom" }) : ok({ id: "sub-g", isGift: true }),
    );
    await paylix.giftSubscription({ productId: "p", customerId: "c" });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("subscription schedule", () => {
  it("giftSubscription POSTs to /api/subscriptions/gift", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "sub-g", isGift: true, status: "active" }));
    const gift = await paylix.giftSubscription({ productId: "prod-1", customerId: "cust-1" });
    expect(call().url).toBe("http://localhost:3000/api/subscriptions/gift");
    expect(call().body).toEqual({ productId: "prod-1", customerId: "cust-1" });
    expect(gift.isGift).toBe(true);
  });

  it("scheduleSubscriptionCancellation sends when=period_end", async () => {
    mockFetch.mockResolvedValueOnce(ok({ cancelAt: "2026-08-15T00:00:00Z" }));
    const out = await paylix.scheduleSubscriptionCancellation("sub-1");
    expect(call().url).toBe("http://localhost:3000/api/subscriptions/sub-1/cancel");
    expect(call().body).toEqual({ when: "period_end" });
    expect(out.cancelAt).toBe("2026-08-15T00:00:00Z");
  });

  it("resumeSubscriptionSchedule reports the server message on failure", async () => {
    mockFetch.mockResolvedValueOnce(fail(404, { error: "No cancellation scheduled" }));
    await expect(paylix.resumeSubscriptionSchedule("sub-1")).rejects.toThrow(
      "No cancellation scheduled",
    );
  });
});

describe("coupons", () => {
  it("createCoupon POSTs the params", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "cpn-1", code: "WELCOME10" }));
    await paylix.createCoupon({ code: "WELCOME10", type: "percent", percentOff: 10, duration: "once" });
    expect(call().url).toBe("http://localhost:3000/api/coupons");
    expect(call().body).toEqual({
      code: "WELCOME10",
      type: "percent",
      percentOff: 10,
      duration: "once",
    });
  });

  it("listCoupons GETs /api/coupons", async () => {
    mockFetch.mockResolvedValueOnce(ok([{ id: "cpn-1" }]));
    expect(await paylix.listCoupons()).toHaveLength(1);
    expect(call().url).toBe("http://localhost:3000/api/coupons");
  });

  it("archiveCoupon DELETEs", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    await paylix.archiveCoupon("cpn-1");
    expect(call().method).toBe("DELETE");
    expect(call().url).toBe("http://localhost:3000/api/coupons/cpn-1");
  });

  it("archiveCoupon reports the server message, not just the status text", async () => {
    // Regression for SDK-06: this path used to report only `statusText`.
    mockFetch.mockResolvedValueOnce(fail(400, { error: "Coupon already archived" }));
    await expect(paylix.archiveCoupon("cpn-1")).rejects.toThrow("Coupon already archived");
  });

  it("applyCouponToCheckout POSTs the code", async () => {
    mockFetch.mockResolvedValueOnce(ok({ ok: true, discountCents: 100, amount: "9.00" }));
    const out = await paylix.applyCouponToCheckout("sess-1", "WELCOME10");
    expect(call().url).toBe("http://localhost:3000/api/checkout/sess-1/apply-coupon");
    expect(call().body).toEqual({ code: "WELCOME10" });
    expect(out.discountCents).toBe(100);
  });

  it("removeCouponFromCheckout DELETEs the same path", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    await paylix.removeCouponFromCheckout("sess-1");
    expect(call().method).toBe("DELETE");
    expect(call().url).toBe("http://localhost:3000/api/checkout/sess-1/apply-coupon");
  });
});

describe("blocklist", () => {
  it("listBlocklist GETs /api/blocklist", async () => {
    mockFetch.mockResolvedValueOnce(ok([{ id: "bl-1", type: "wallet", value: "0xbad" }]));
    expect(await paylix.listBlocklist()).toHaveLength(1);
  });

  it("addBlocklistEntry POSTs the entry", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "bl-1", type: "email", value: "a@b.com" }));
    await paylix.addBlocklistEntry({ type: "email", value: "a@b.com", reason: "fraud" });
    expect(call().body).toEqual({ type: "email", value: "a@b.com", reason: "fraud" });
  });

  it("removeBlocklistEntry surfaces the server message", async () => {
    // Regression for SDK-06: this path used to report only `statusText`.
    mockFetch.mockResolvedValueOnce(fail(404, { error: { message: "Entry not found" } }));
    await expect(paylix.removeBlocklistEntry("bl-1")).rejects.toThrow("Entry not found");
  });
});

describe("payment links", () => {
  it("prefers the server-issued url", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({ id: "pl-1", url: "https://checkout.example.com/pay/pl-1" }),
    );
    const out = await paylix.createPaymentLink({ productId: "prod-1", name: "Launch" });
    expect(out.url).toBe("https://checkout.example.com/pay/pl-1");
  });

  it("falls back to backendUrl/pay/:id when the server omits url", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "pl-1" }));
    const out = await paylix.createPaymentLink({ productId: "prod-1", name: "Launch" });
    expect(out.url).toBe("http://localhost:3000/pay/pl-1");
  });

  it("listPaymentLinks surfaces the server message", async () => {
    // Regression for SDK-06: this path used to report only `statusText`.
    mockFetch.mockResolvedValueOnce(fail(403, { error: "Publishable keys cannot list links" }));
    await expect(paylix.listPaymentLinks()).rejects.toThrow(
      "Publishable keys cannot list links",
    );
  });

  it("updatePaymentLink PATCHes", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "pl-1", isActive: false }));
    await paylix.updatePaymentLink("pl-1", { isActive: false });
    expect(call().method).toBe("PATCH");
    expect(call().body).toEqual({ isActive: false });
  });

  it("archivePaymentLink DELETEs", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    await paylix.archivePaymentLink("pl-1");
    expect(call().method).toBe("DELETE");
  });

  it("getPaymentLink GETs by id", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "pl-1" }));
    expect((await paylix.getPaymentLink("pl-1")).id).toBe("pl-1");
    expect(call().url).toBe("http://localhost:3000/api/payment-links/pl-1");
  });
});
