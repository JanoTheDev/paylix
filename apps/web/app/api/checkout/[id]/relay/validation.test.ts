import { describe, it, expect } from "vitest";
import {
  parseRelayBody,
  validateSessionForRelay,
  validateDeadline,
  normalizePermitV,
} from "./validation";

const validBody = {
  buyer: "0x" + "a".repeat(40),
  deadline: "1800000000",
  v: 27,
  r: "0x" + "1".repeat(64),
  s: "0x" + "2".repeat(64),
  permitValue: "10000000000",
  // 65-byte signature: r (32) || s (32) || v (1)
  intentSignature: "0x" + "3".repeat(128) + "1b",
};

describe("parseRelayBody", () => {
  it("accepts a valid body", () => {
    const result = parseRelayBody(validBody);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.buyer).toBe(validBody.buyer);
      expect(result.value.deadline).toBe(BigInt(1800000000));
      expect(result.value.permitValue).toBe(BigInt(10000000000));
      expect(result.value.v).toBe(27);
    }
  });

  it("rejects non-hex buyer", () => {
    const result = parseRelayBody({ ...validBody, buyer: "not-a-hex" });
    expect(result.ok).toBe(false);
  });

  it("rejects buyer that is too short", () => {
    const result = parseRelayBody({ ...validBody, buyer: "0xabc" });
    expect(result.ok).toBe(false);
  });

  it("rejects v out of uint8 range", () => {
    const result = parseRelayBody({ ...validBody, v: 300 });
    expect(result.ok).toBe(false);
  });

  it("rejects non-integer v", () => {
    const result = parseRelayBody({ ...validBody, v: 27.5 });
    expect(result.ok).toBe(false);
  });

  it("rejects r of wrong length", () => {
    const result = parseRelayBody({ ...validBody, r: "0x1234" });
    expect(result.ok).toBe(false);
  });

  it("rejects deadline of zero", () => {
    const result = parseRelayBody({ ...validBody, deadline: "0" });
    expect(result.ok).toBe(false);
  });

  it("rejects negative permitValue via zero check", () => {
    const result = parseRelayBody({ ...validBody, permitValue: "0" });
    expect(result.ok).toBe(false);
  });

  it("accepts numeric deadline and permitValue", () => {
    const result = parseRelayBody({
      ...validBody,
      deadline: 1800000000,
      permitValue: 10000000000,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing intentSignature", () => {
    const { intentSignature: _, ...rest } = validBody;
    const result = parseRelayBody(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_body");
  });

  it("rejects intentSignature of wrong length", () => {
    const result = parseRelayBody({ ...validBody, intentSignature: "0x1234" });
    expect(result.ok).toBe(false);
  });

  it("rejects non-hex intentSignature", () => {
    const result = parseRelayBody({
      ...validBody,
      intentSignature: "not a hex string of any length really",
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateSessionForRelay", () => {
  const future = new Date(Date.now() + 10 * 60 * 1000);
  const past = new Date(Date.now() - 1000);

  it("accepts an active unpaid session", () => {
    const result = validateSessionForRelay({
      status: "active",
      expiresAt: future,
      paymentId: null,
      subscriptionId: null,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a viewed unpaid session", () => {
    const result = validateSessionForRelay({
      status: "viewed",
      expiresAt: future,
      paymentId: null,
      subscriptionId: null,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects null session", () => {
    const result = validateSessionForRelay(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("session_not_found");
  });

  it("rejects expired session", () => {
    const result = validateSessionForRelay({
      status: "active",
      expiresAt: past,
      paymentId: null,
      subscriptionId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("session_expired");
  });

  it("rejects completed session", () => {
    const result = validateSessionForRelay({
      status: "completed",
      expiresAt: future,
      paymentId: null,
      subscriptionId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("session_not_payable");
  });

  it("rejects abandoned session", () => {
    const result = validateSessionForRelay({
      status: "abandoned",
      expiresAt: future,
      paymentId: null,
      subscriptionId: null,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects session that already has a paymentId (already relayed)", () => {
    const result = validateSessionForRelay({
      status: "active",
      expiresAt: future,
      paymentId: "payment-uuid",
      subscriptionId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("session_already_relayed");
  });

  it("rejects session that already has a subscriptionId", () => {
    const result = validateSessionForRelay({
      status: "active",
      expiresAt: future,
      paymentId: null,
      subscriptionId: "sub-uuid",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("session_already_relayed");
  });
});

describe("validateDeadline", () => {
  it("accepts a future deadline", () => {
    const future = BigInt(Math.floor(Date.now() / 1000) + 600);
    const result = validateDeadline(future);
    expect(result.ok).toBe(true);
  });

  it("rejects a past deadline", () => {
    const past = BigInt(Math.floor(Date.now() / 1000) - 600);
    const result = validateDeadline(past);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("deadline_passed");
  });

  it("rejects a deadline equal to now", () => {
    const now = new Date();
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
    const result = validateDeadline(nowSeconds, now);
    expect(result.ok).toBe(false);
  });
});

describe("normalizePermitV", () => {
  it("maps 0 → 27", () => {
    expect(normalizePermitV(0)).toBe(27);
  });
  it("maps 1 → 28", () => {
    expect(normalizePermitV(1)).toBe(28);
  });
  it("passes 27 through unchanged", () => {
    expect(normalizePermitV(27)).toBe(27);
  });
  it("passes 28 through unchanged", () => {
    expect(normalizePermitV(28)).toBe(28);
  });
  it("passes other legacy values through unchanged", () => {
    expect(normalizePermitV(35)).toBe(35);
  });
});

describe("parseRelayBody with legacy v", () => {
  it("normalizes v=0 to v=27 in the parsed result", () => {
    const result = parseRelayBody({ ...validBody, v: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.v).toBe(27);
    }
  });
  it("normalizes v=1 to v=28", () => {
    const result = parseRelayBody({ ...validBody, v: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.v).toBe(28);
    }
  });
});
