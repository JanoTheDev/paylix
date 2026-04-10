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
});
