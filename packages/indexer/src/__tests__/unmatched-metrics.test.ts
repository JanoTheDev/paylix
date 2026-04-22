import { describe, it, expect } from "vitest";
import {
  summarizeRetryPass,
  shouldWarn,
  UNMATCHED_PENDING_WARN_THRESHOLD,
  UNMATCHED_AGE_WARN_SECONDS,
} from "../unmatched-metrics";

describe("summarizeRetryPass", () => {
  const now = new Date("2026-04-22T12:00:00Z").getTime();

  it("produces the expected structured log shape", () => {
    const summary = summarizeRetryPass({
      queueDepthBefore: 3,
      retriedRows: [
        { createdAt: new Date(now - 10_000), matched: true },
        { createdAt: new Date(now - 30_000), matched: false },
        { createdAt: new Date(now - 60_000), matched: true },
      ],
      nowMs: now,
    });
    expect(summary).toEqual({
      event: "unmatched_retry_pass",
      pending: 3,
      retried: 3,
      matched: 2,
      ageSecondsP95: 60,
      oldestAgeSeconds: 60,
    });
  });

  it("returns zeroed ages when no rows retried", () => {
    const summary = summarizeRetryPass({
      queueDepthBefore: 0,
      retriedRows: [],
      nowMs: now,
    });
    expect(summary.retried).toBe(0);
    expect(summary.matched).toBe(0);
    expect(summary.ageSecondsP95).toBe(0);
    expect(summary.oldestAgeSeconds).toBe(0);
  });

  it("clamps negative ages to zero (clock skew safety)", () => {
    const summary = summarizeRetryPass({
      queueDepthBefore: 1,
      retriedRows: [{ createdAt: new Date(now + 5000), matched: true }],
      nowMs: now,
    });
    expect(summary.ageSecondsP95).toBe(0);
    expect(summary.oldestAgeSeconds).toBe(0);
  });
});

describe("shouldWarn", () => {
  const base = {
    event: "unmatched_retry_pass" as const,
    pending: 0,
    retried: 0,
    matched: 0,
    ageSecondsP95: 0,
    oldestAgeSeconds: 0,
  };

  it("does not warn under thresholds", () => {
    expect(
      shouldWarn({
        ...base,
        pending: UNMATCHED_PENDING_WARN_THRESHOLD,
        oldestAgeSeconds: UNMATCHED_AGE_WARN_SECONDS,
      }),
    ).toBe(false);
  });

  it("warns when pending exceeds threshold", () => {
    expect(
      shouldWarn({ ...base, pending: UNMATCHED_PENDING_WARN_THRESHOLD + 1 }),
    ).toBe(true);
  });

  it("warns when oldestAgeSeconds exceeds threshold", () => {
    expect(
      shouldWarn({
        ...base,
        oldestAgeSeconds: UNMATCHED_AGE_WARN_SECONDS + 1,
      }),
    ).toBe(true);
  });
});
