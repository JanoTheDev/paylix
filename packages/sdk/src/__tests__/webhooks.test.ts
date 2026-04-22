import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { webhooks } from "../webhooks";

describe("webhooks.verify", () => {
  const secret = "whsec_test_secret_123";
  const payload = '{"event":"payment.confirmed","data":{}}';

  function sign(body: string, key: string): string {
    const hmac = createHmac("sha256", key).update(body).digest("hex");
    return `sha256=${hmac}`;
  }

  it("returns true for valid signature", () => {
    const signature = sign(payload, secret);
    expect(webhooks.verify({ payload, signature, secret })).toBe(true);
  });

  it("returns false for invalid signature", () => {
    expect(webhooks.verify({ payload, signature: "sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", secret })).toBe(false);
  });

  it("returns false for missing sha256= prefix", () => {
    const hmac = createHmac("sha256", secret).update(payload).digest("hex");
    expect(webhooks.verify({ payload, signature: hmac, secret })).toBe(false);
  });

  it("returns false for tampered payload", () => {
    const signature = sign(payload, secret);
    const tampered = '{"event":"payment.confirmed","data":{"hacked":true}}';
    expect(webhooks.verify({ payload: tampered, signature, secret })).toBe(false);
  });

  it("returns false for wrong secret", () => {
    const signature = sign(payload, secret);
    expect(webhooks.verify({ payload, signature, secret: "wrong_secret" })).toBe(false);
  });

  it("works with Buffer payload", () => {
    const bufPayload = Buffer.from(payload, "utf-8");
    const signature = sign(payload, secret);
    expect(webhooks.verify({ payload: bufPayload, signature, secret })).toBe(true);
  });

  // ---- Timestamped v1 format ----

  function signV1(body: string, key: string, ts: number): string {
    const hmac = createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");
    return `t=${ts},v1=${hmac}`;
  }

  it("accepts a fresh v1 signature", () => {
    const ts = 2_000_000_000;
    const signature = signV1(payload, secret, ts);
    expect(
      webhooks.verify({ payload, signature, secret, nowSeconds: ts + 10 }),
    ).toBe(true);
  });

  it("rejects a v1 signature older than the window", () => {
    const ts = 2_000_000_000;
    const signature = signV1(payload, secret, ts);
    expect(
      webhooks.verify({
        payload,
        signature,
        secret,
        nowSeconds: ts + 600, // 10 min > default 5 min
      }),
    ).toBe(false);
  });

  it("respects a custom maxAgeSeconds window", () => {
    const ts = 2_000_000_000;
    const signature = signV1(payload, secret, ts);
    expect(
      webhooks.verify({
        payload,
        signature,
        secret,
        nowSeconds: ts + 1000,
        maxAgeSeconds: 2000,
      }),
    ).toBe(true);
  });

  it("rejects v1 with tampered body", () => {
    const ts = 2_000_000_000;
    const signature = signV1(payload, secret, ts);
    const tampered = '{"event":"payment.confirmed","data":{"hacked":true}}';
    expect(
      webhooks.verify({
        payload: tampered,
        signature,
        secret,
        nowSeconds: ts,
      }),
    ).toBe(false);
  });

  it("rejects v1 with wrong secret", () => {
    const ts = 2_000_000_000;
    const signature = signV1(payload, secret, ts);
    expect(
      webhooks.verify({
        payload,
        signature,
        secret: "wrong",
        nowSeconds: ts,
      }),
    ).toBe(false);
  });

  it("rejects v1 with non-numeric timestamp", () => {
    const signature = `t=abc,v1=${createHmac("sha256", secret)
      .update("abc." + payload)
      .digest("hex")}`;
    expect(webhooks.verify({ payload, signature, secret })).toBe(false);
  });

  it("rejects malformed combined header", () => {
    expect(
      webhooks.verify({
        payload,
        signature: "t=2000000000",
        secret,
      }),
    ).toBe(false);
  });

  it("rejects empty signature", () => {
    expect(webhooks.verify({ payload, signature: "", secret })).toBe(false);
  });
});
