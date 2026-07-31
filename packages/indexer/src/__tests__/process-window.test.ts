import { describe, it, expect, vi, beforeEach } from "vitest";
import { processWindow, type ProcessWindowDeps } from "../process-window";

type TestLog = { id: string; block: bigint };

function makeDeps(overrides: Partial<ProcessWindowDeps<TestLog>> = {}) {
  const cursorWrites: bigint[] = [];
  const handled: string[] = [];
  const retained: string[] = [];

  const deps: ProcessWindowDeps<TestLog> = {
    key: "test_cursor",
    label: "live",
    eventName: "PaymentReceived",
    chunkSize: 10n,
    delayMs: 0,
    isStopped: () => false,
    getLogs: async () => [],
    handle: async (log) => {
      handled.push(log.id);
    },
    retain: async (log) => {
      retained.push(log.id);
      return true;
    },
    setLastBlock: async (block) => {
      cursorWrites.push(block);
    },
    // Keep the retry backoff instant in tests.
    sleepFn: async () => {},
    ...overrides,
  };

  return { deps, cursorWrites, handled, retained };
}

describe("processWindow cursor advancement", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("advances the cursor chunk by chunk when everything succeeds", async () => {
    const { deps, cursorWrites, handled } = makeDeps({
      getLogs: async (from) => [{ id: `log-${from}`, block: from }],
    });

    const result = await processWindow(deps, 1n, 30n);

    expect(cursorWrites).toEqual([10n, 20n, 30n]);
    expect(handled).toEqual(["log-1", "log-11", "log-21"]);
    expect(result).toMatchObject({ totalLogs: 3, lastProcessed: 30n, aborted: false });
  });

  it("does NOT advance past a chunk it could not read", async () => {
    // The poisoned-chunk case: a transient RPC error used to advance the cursor
    // and skip the block range forever.
    const getLogs = vi.fn(async (from: bigint) => {
      if (from === 11n) throw new Error("connection reset");
      return [{ id: `log-${from}`, block: from }];
    });
    const { deps, cursorWrites } = makeDeps({ getLogs });

    const result = await processWindow(deps, 1n, 30n);

    expect(cursorWrites).toEqual([10n]); // never 20n or 30n
    expect(result.aborted).toBe(true);
    expect(result.lastProcessed).toBe(10n);
  });

  it("retries a failing chunk before giving up", async () => {
    let calls = 0;
    const getLogs = vi.fn(async (from: bigint) => {
      calls++;
      if (from === 1n && calls < 3) throw new Error("502");
      return [];
    });
    const { deps, cursorWrites } = makeDeps({ getLogs });

    const result = await processWindow(deps, 1n, 10n);

    expect(calls).toBe(3);
    expect(cursorWrites).toEqual([10n]);
    expect(result.aborted).toBe(false);
  });

  it("retains a log whose handler threw, then advances", async () => {
    const { deps, cursorWrites, retained } = makeDeps({
      getLogs: async (from) =>
        from === 1n ? [{ id: "boom", block: 1n }, { id: "ok", block: 2n }] : [],
      handle: async (log) => {
        if (log.id === "boom") throw new Error("db hiccup");
      },
    });

    const result = await processWindow(deps, 1n, 20n);

    // The failed log is durably queued for replay, so advancing is safe.
    expect(retained).toEqual(["boom"]);
    expect(cursorWrites).toEqual([10n, 20n]);
    expect(result.aborted).toBe(false);
  });

  it("aborts without advancing when the failed log cannot be retained", async () => {
    // No retention path (e.g. PastDue/Cancelled) or the retention write failed:
    // the event exists only on-chain, so the range must be re-read.
    const { deps, cursorWrites } = makeDeps({
      getLogs: async (from) => (from === 1n ? [{ id: "boom", block: 1n }] : []),
      handle: async () => {
        throw new Error("db down");
      },
      retain: async () => false,
    });

    const result = await processWindow(deps, 1n, 20n);

    expect(cursorWrites).toEqual([]);
    expect(result.aborted).toBe(true);
    expect(result.lastProcessed).toBe(0n);
  });

  it("stops cleanly when shutdown is requested mid-window", async () => {
    let stopped = false;
    const { deps, cursorWrites } = makeDeps({
      isStopped: () => stopped,
      getLogs: async (from) => {
        if (from === 11n) stopped = true;
        return [];
      },
    });

    const result = await processWindow(deps, 1n, 30n);

    expect(cursorWrites).toEqual([10n, 20n]);
    expect(result.aborted).toBe(false);
  });

  it("does not retry a rate-limited chunk (backoff already happened upstream)", async () => {
    const getLogs = vi.fn(async () => {
      throw new Error("429 Too Many Requests");
    });
    const { deps, cursorWrites } = makeDeps({ getLogs });

    const result = await processWindow(deps, 1n, 10n);

    expect(getLogs).toHaveBeenCalledTimes(1);
    expect(cursorWrites).toEqual([]);
    expect(result.aborted).toBe(true);
  });
});
