import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";

function generateSignature(secret: string, payload: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

function getNextRetryTime(attempt: number): Date {
  const delays = [60, 300, 1800, 7200, 43200];
  const delaySec = delays[Math.min(attempt - 1, delays.length - 1)];
  return new Date(Date.now() + delaySec * 1000);
}

describe("webhook signature generation", () => {
  it("generates valid HMAC-SHA256 signature", () => {
    const secret = "whsec_test123";
    const payload = '{"event":"payment.confirmed"}';
    const sig = generateSignature(secret, payload);
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("produces different signatures for different secrets", () => {
    const payload = '{"event":"payment.confirmed"}';
    const sig1 = generateSignature("secret_a", payload);
    const sig2 = generateSignature("secret_b", payload);
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different payloads", () => {
    const secret = "whsec_test123";
    const sig1 = generateSignature(secret, '{"event":"payment.confirmed"}');
    const sig2 = generateSignature(secret, '{"event":"subscription.created"}');
    expect(sig1).not.toBe(sig2);
  });

  it("is deterministic", () => {
    const secret = "whsec_test123";
    const payload = '{"event":"payment.confirmed"}';
    expect(generateSignature(secret, payload)).toBe(generateSignature(secret, payload));
  });
});

describe("retry scheduling", () => {
  it("first retry is 1 minute", () => {
    const now = Date.now();
    const retry = getNextRetryTime(1);
    const diffSec = (retry.getTime() - now) / 1000;
    expect(Math.round(diffSec)).toBe(60);
  });

  it("second retry is 5 minutes", () => {
    const now = Date.now();
    const retry = getNextRetryTime(2);
    const diffSec = (retry.getTime() - now) / 1000;
    expect(Math.round(diffSec)).toBe(300);
  });

  it("fifth retry is 12 hours", () => {
    const now = Date.now();
    const retry = getNextRetryTime(5);
    const diffSec = (retry.getTime() - now) / 1000;
    expect(Math.round(diffSec)).toBe(43200);
  });

  it("caps at 12 hours for attempts beyond 5", () => {
    const now = Date.now();
    const retry = getNextRetryTime(10);
    const diffSec = (retry.getTime() - now) / 1000;
    expect(Math.round(diffSec)).toBe(43200);
  });
});
