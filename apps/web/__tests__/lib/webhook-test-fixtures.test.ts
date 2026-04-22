import { describe, it, expect } from "vitest";
import {
  WEBHOOK_EVENT_TYPES,
  fixtureDataFor,
  isKnownEventType,
} from "../../lib/webhook-test-fixtures";

describe("webhook test fixtures", () => {
  it("has one fixture per event type", () => {
    for (const ev of WEBHOOK_EVENT_TYPES) {
      const data = fixtureDataFor(ev);
      expect(data).toBeDefined();
      expect(typeof data).toBe("object");
    }
  });

  it("is deterministic — same event returns byte-identical data", () => {
    for (const ev of WEBHOOK_EVENT_TYPES) {
      expect(JSON.stringify(fixtureDataFor(ev))).toBe(
        JSON.stringify(fixtureDataFor(ev)),
      );
    }
  });

  it("isKnownEventType accepts and rejects as expected", () => {
    expect(isKnownEventType("payment.confirmed")).toBe(true);
    expect(isKnownEventType("coupon.redeemed")).toBe(true);
    expect(isKnownEventType("not.a.real.event")).toBe(false);
  });

  it("payment.confirmed fixture carries the documented shape", () => {
    const data = fixtureDataFor("payment.confirmed");
    expect(data).toMatchObject({
      paymentId: expect.any(String),
      amount: expect.any(Number),
      currency: expect.any(String),
      chain: expect.any(String),
      txHash: expect.stringMatching(/^0x/),
    });
  });

  it("trial event fixtures carry subscriberAddress + trialEndsAt", () => {
    for (const ev of [
      "subscription.trial_started",
      "subscription.trial_ending",
      "subscription.trial_cancelled",
    ] as const) {
      const data = fixtureDataFor(ev);
      expect(data.subscriberAddress).toMatch(/^0x/);
      expect(data.trialEndsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
