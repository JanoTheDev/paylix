import { describe, it, expect } from "vitest";
import { computePauseUpdate, computeResumeUpdate } from "../pause/logic";

describe("computePauseUpdate", () => {
  it("returns paused fields when sub is active", () => {
    const now = new Date("2026-04-12T10:00:00Z");
    const result = computePauseUpdate({ status: "active" }, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.update.status).toBe("paused");
      expect(result.update.pausedAt).toEqual(now);
    }
  });

  it("rejects pausing a trialing sub", () => {
    const result = computePauseUpdate({ status: "trialing" }, new Date());
    expect(result.ok).toBe(false);
  });

  it("rejects pausing a cancelled sub", () => {
    const result = computePauseUpdate({ status: "cancelled" }, new Date());
    expect(result.ok).toBe(false);
  });
});

describe("computeResumeUpdate", () => {
  it("shifts nextChargeDate forward by paused duration", () => {
    const pausedAt = new Date("2026-04-12T00:00:00Z");
    const nextChargeDate = new Date("2026-04-15T00:00:00Z");
    const now = new Date("2026-04-13T00:00:00Z"); // 1 day paused
    const result = computeResumeUpdate(
      { status: "paused", pausedAt, nextChargeDate },
      now,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.update.status).toBe("active");
      expect(result.update.pausedAt).toBeNull();
      expect(result.update.nextChargeDate).toEqual(new Date("2026-04-16T00:00:00Z"));
    }
  });

  it("rejects resuming a non-paused sub", () => {
    const result = computeResumeUpdate({ status: "active", pausedAt: null, nextChargeDate: new Date() }, new Date());
    expect(result.ok).toBe(false);
  });
});
