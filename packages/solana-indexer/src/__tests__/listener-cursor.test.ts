import { describe, it, expect, vi } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { startListener, type ListenerEvent } from "../listener";
import type { SlotCursor } from "../cursor";

const PROGRAM = new PublicKey("11111111111111111111111111111111");
const PROGRAM_KEY = PROGRAM.toBase58();

/** A valid `SubscriptionCancelled` Program data line (the shortest event). */
function programDataLine(subscriptionId: bigint): string {
  const disc = Buffer.from(
    sha256(new TextEncoder().encode("event:SubscriptionCancelled")),
  ).subarray(0, 8);
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(subscriptionId);
  return `Program data: ${Buffer.concat([disc, id]).toString("base64")}`;
}

function makeCursor(initial: number | null = null) {
  const state = { slot: initial, gaps: [] as Array<{ from: number; to: number }> };
  const cursor: SlotCursor = {
    async get() {
      return state.slot;
    },
    async set(_programId: string, slot: number) {
      state.slot = slot;
    },
    async recordGap(_programId: string, fromSlot: number, toSlot: number) {
      state.gaps.push({ from: fromSlot, to: toSlot });
    },
  };
  return { cursor, state };
}

interface FakeSig {
  signature: string;
  slot: number;
  err?: unknown;
}

/**
 * `getSignaturesForAddress` returns newest-first and pages backwards via
 * `before`, which is what the catch-up walk assumes.
 */
function makeConnection(sigs: FakeSig[], opts: { missingTx?: Set<string> } = {}) {
  const newestFirst = [...sigs].sort((a, b) => b.slot - a.slot);
  const liveHandlers: Array<(logs: unknown, ctx: { slot: number }) => void> = [];
  const conn = {
    onLogs: vi.fn((_pid: PublicKey, cb: (logs: unknown, ctx: { slot: number }) => void) => {
      liveHandlers.push(cb);
      return 1;
    }),
    removeOnLogsListener: vi.fn(async () => true),
    getSlot: vi.fn(async () => 1000),
    getSignaturesForAddress: vi.fn(
      async (_pid: PublicKey, options?: { before?: string; limit?: number }) => {
        let start = 0;
        if (options?.before) {
          start = newestFirst.findIndex((s) => s.signature === options.before) + 1;
        }
        return newestFirst.slice(start, start + (options?.limit ?? 1000));
      },
    ),
    getTransaction: vi.fn(async (signature: string) => {
      if (opts.missingTx?.has(signature)) return null;
      const found = newestFirst.find((s) => s.signature === signature);
      if (!found) return null;
      return { slot: found.slot, meta: { err: null, logMessages: [programDataLine(1n)] } };
    }),
  };
  return { connection: conn as unknown as Connection, liveHandlers, raw: conn };
}

describe("listener catch-up cursor", () => {
  it("advances the cursor only over signatures whose dispatch succeeded", async () => {
    const { cursor, state } = makeCursor(100);
    const { connection } = makeConnection([
      { signature: "sigA", slot: 101 },
      { signature: "sigB", slot: 102 },
      { signature: "sigC", slot: 103 },
    ]);

    const seen: string[] = [];
    const handle = await startListener({
      connection,
      programIds: [PROGRAM],
      cursor,
      catchUpIntervalMs: 3_600_000,
      onEvent: async (ev: ListenerEvent) => {
        // sigB is the poisoned one.
        if (ev.signature === "sigB") throw new Error("DB write failed");
        seen.push(ev.signature);
      },
    });

    // sigA processed, sigB threw -> the pass stops with the cursor behind it.
    expect(seen).toEqual(["sigA"]);
    expect(state.slot).toBe(101);
    await handle.stop();
  });

  it("re-enumerates and retries the failed signature on the next pass", async () => {
    const { cursor, state } = makeCursor(100);
    const { connection } = makeConnection([
      { signature: "sigA", slot: 101 },
      { signature: "sigB", slot: 102 },
      { signature: "sigC", slot: 103 },
    ]);

    let failB = true;
    const seen: string[] = [];
    const handle = await startListener({
      connection,
      programIds: [PROGRAM],
      cursor,
      catchUpIntervalMs: 3_600_000,
      onEvent: async (ev: ListenerEvent) => {
        if (ev.signature === "sigB" && failB) throw new Error("DB write failed");
        seen.push(ev.signature);
      },
    });
    expect(state.slot).toBe(101);

    failB = false;
    await handle.catchUp();

    // sigA is already complete and is not re-dispatched; B and C now land.
    expect(seen).toEqual(["sigA", "sigB", "sigC"]);
    expect(state.slot).toBe(103);
    await handle.stop();
  });

  it("does not advance past a signature whose live dispatch is still in flight and then fails", async () => {
    // Cursor starts ahead of both slots so the boot pass is a no-op and the
    // live subscription gets to claim sigA first.
    const { cursor, state } = makeCursor(502);
    const { connection, liveHandlers } = makeConnection([
      { signature: "sigA", slot: 500 },
      { signature: "sigB", slot: 501 },
    ]);

    let openGate: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      openGate = r;
    });
    let signalEntered: (() => void) | undefined;
    const entered = new Promise<void>((r) => {
      signalEntered = r;
    });

    const handle = await startListener({
      connection,
      programIds: [PROGRAM],
      cursor,
      catchUpIntervalMs: 3_600_000,
      onEvent: async (ev: ListenerEvent) => {
        if (ev.signature !== "sigA") return;
        signalEntered?.();
        await gate;
        throw new Error("live DB write failed");
      },
    });
    expect(state.slot).toBe(502);

    // Rewind so the catch-up pass will enumerate slots 500 and 501.
    await cursor.set(PROGRAM_KEY, 499);

    // Live delivery of sigA starts and blocks inside onEvent.
    liveHandlers[0]!({ err: null, logs: [programDataLine(1n)], signature: "sigA" }, { slot: 500 });
    await entered;

    // Catch-up runs while sigA is still in flight. It must JOIN that attempt
    // rather than treat "started" as "done": otherwise it advances to 500,
    // then processes sigB and advances to 501, and the `slot < fromSlot`
    // filter never re-enumerates slot 500 again.
    const pass = handle.catchUp();
    openGate?.();
    await pass;

    expect(state.slot).toBe(499);
    await handle.stop();
  });

  it("records a gap and does not silently skip when the pass is truncated", async () => {
    const { cursor, state } = makeCursor(0);
    const sigs = Array.from({ length: 5 }, (_, i) => ({
      signature: `sig${i}`,
      slot: 100 + i,
    }));
    const { connection } = makeConnection(sigs);

    const handle = await startListener({
      connection,
      programIds: [PROGRAM],
      cursor,
      catchUpIntervalMs: 3_600_000,
      maxCatchUpSignatures: 2,
      onEvent: async () => {},
    });

    // Only the two newest were enumerated; the untouched older range is
    // recorded rather than passed over in silence.
    expect(state.gaps).toEqual([{ from: 0, to: 102 }]);
    expect(state.slot).toBe(104);
    await handle.stop();
  });

  it("stops the pass without advancing when a transaction is not yet queryable", async () => {
    const { cursor, state } = makeCursor(100);
    const { connection } = makeConnection(
      [
        { signature: "sigA", slot: 101 },
        { signature: "sigB", slot: 102 },
      ],
      { missingTx: new Set(["sigB"]) },
    );

    const handle = await startListener({
      connection,
      programIds: [PROGRAM],
      cursor,
      catchUpIntervalMs: 3_600_000,
      onEvent: async () => {},
    });

    expect(state.slot).toBe(101);
    await handle.stop();
  });

  it("skips a failed on-chain transaction but still accounts for its slot", async () => {
    const { cursor, state } = makeCursor(100);
    const { connection } = makeConnection([
      { signature: "sigA", slot: 101, err: { InstructionError: [0, "Custom"] } },
      { signature: "sigB", slot: 102 },
    ]);

    const seen: string[] = [];
    const handle = await startListener({
      connection,
      programIds: [PROGRAM],
      cursor,
      catchUpIntervalMs: 3_600_000,
      onEvent: async (ev: ListenerEvent) => {
        seen.push(ev.signature);
      },
    });

    expect(seen).toEqual(["sigB"]);
    expect(state.slot).toBe(102);
    await handle.stop();
  });

  it("does not re-dispatch a signature the live subscription already completed", async () => {
    // Cursor ahead of the signature so the boot pass is a no-op.
    const { cursor, state } = makeCursor(501);
    const { connection, liveHandlers } = makeConnection([{ signature: "sigA", slot: 500 }]);

    const seen: string[] = [];
    const handle = await startListener({
      connection,
      programIds: [PROGRAM],
      cursor,
      catchUpIntervalMs: 3_600_000,
      onEvent: async (ev: ListenerEvent) => {
        seen.push(ev.signature);
      },
    });
    expect(seen).toEqual([]);

    // Live delivery lands, then the cursor is rewound so the catch-up pass
    // re-enumerates the same slot.
    liveHandlers[0]!({ err: null, logs: [programDataLine(1n)], signature: "sigA" }, { slot: 500 });
    await new Promise((r) => setTimeout(r, 10));
    await cursor.set(PROGRAM_KEY, 499);
    await handle.catchUp();

    // Handled exactly once, and the cursor still advances over it.
    expect(seen).toEqual(["sigA"]);
    expect(state.slot).toBe(500);
    await handle.stop();
  });
});
