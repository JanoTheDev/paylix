import { describe, it, expect } from "vitest";
import { classifyRestart } from "../../lib/checkout-restart";

const now = new Date("2026-04-22T12:00:00Z");
const future = new Date(now.getTime() + 10 * 60 * 1000);
const past = new Date(now.getTime() - 1);

describe("classifyRestart", () => {
  it("returns not_found for a null session", () => {
    expect(classifyRestart(null, now)).toBe("not_found");
  });

  it("reuses an active, unexpired session", () => {
    expect(
      classifyRestart({ status: "active", expiresAt: future }, now),
    ).toBe("reuse");
  });

  it("reuses an awaiting_currency session", () => {
    expect(
      classifyRestart({ status: "awaiting_currency", expiresAt: future }, now),
    ).toBe("reuse");
  });

  it("creates a new session for a completed checkout", () => {
    expect(
      classifyRestart({ status: "completed", expiresAt: future }, now),
    ).toBe("create_new");
  });

  it("creates a new session for an expired status", () => {
    expect(
      classifyRestart({ status: "expired", expiresAt: past }, now),
    ).toBe("create_new");
  });

  it("creates a new session when status is active but expiresAt elapsed", () => {
    expect(
      classifyRestart({ status: "active", expiresAt: past }, now),
    ).toBe("create_new");
  });

  it("creates a new session for an abandoned checkout", () => {
    expect(
      classifyRestart({ status: "abandoned", expiresAt: future }, now),
    ).toBe("create_new");
  });
});
