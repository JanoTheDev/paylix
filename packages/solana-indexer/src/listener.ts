import { Connection, PublicKey, type Logs } from "@solana/web3.js";
import { decodeProgramData, type DecodedEvent } from "./decoder";
import type { SlotCursor } from "./cursor";

export interface ListenerEvent {
  signature: string;
  slot: number;
  programId: string;
  event: DecodedEvent;
}

export interface ListenerOptions {
  connection: Connection;
  /** Paylix program IDs to watch (payment_vault + subscription_manager). */
  programIds: PublicKey[];
  /** Commitment level — default 'finalized'; mirror of EVM INDEXER_CONFIRMATIONS invariant. */
  commitment?: "finalized" | "confirmed";
  onEvent(ev: ListenerEvent): Promise<void> | void;
  /**
   * Durable slot cursor. Omitting it disables backfill and restart recovery
   * entirely — only pass undefined from tests.
   */
  cursor?: SlotCursor;
  /** How often to re-scan from the cursor to the head (default 60s). */
  catchUpIntervalMs?: number;
  /** Hard cap on signatures pulled in a single catch-up pass (default 10k). */
  maxCatchUpSignatures?: number;
  /** Slots to look back on a cold start with no stored cursor (default 5000). */
  maxColdStartSlots?: number;
}

export interface ListenerHandle {
  stop(): Promise<void>;
  /** Run one catch-up pass synchronously. Exposed for testing. */
  catchUp(): Promise<void>;
}

/** Signatures per `getSignaturesForAddress` page — the RPC maximum. */
const SIGNATURE_PAGE_SIZE = 1000;
/** Upper bound on the in-process replay guard before the oldest entries age out. */
const PROCESSED_CACHE_MAX = 20_000;

/**
 * Parse Anchor event logs. Anchor prepends `Program data: ` to the
 * base64-encoded event payload. The decoder module identifies each event
 * via its 8-byte discriminator and Borsh-decodes the fields.
 */
function parseLogs(logs: string[]): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    const payload = line.slice("Program data: ".length).trim();
    const decoded = decodeProgramData(payload);
    if (decoded) out.push(decoded);
  }
  return out;
}

export async function startListener(opts: ListenerOptions): Promise<ListenerHandle> {
  const commitment = opts.commitment ?? "finalized";
  const cursor = opts.cursor;
  const catchUpIntervalMs = opts.catchUpIntervalMs ?? 60_000;
  const maxCatchUpSignatures = opts.maxCatchUpSignatures ?? 10_000;
  const maxColdStartSlots = opts.maxColdStartSlots ?? 5_000;

  const subIds: number[] = [];
  // Replay guards shared by the live subscription and the catch-up pass.
  // `completed` holds signatures whose handlers RESOLVED; `dispatching` holds
  // the promise for one still running. Treating "started" as "done" let the
  // catch-up pass advance the cursor past a live dispatch that then failed,
  // and the `slot < fromSlot` filter meant that slot was never re-enumerated.
  // Restart-level idempotency remains the DB's job (payments_chain_tx_idx).
  const completed = new Set<string>();
  const dispatching = new Map<string, Promise<void>>();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  function markCompleted(key: string): void {
    completed.add(key);
    if (completed.size > PROCESSED_CACHE_MAX) {
      // Sets iterate in insertion order — drop the oldest tenth.
      let dropped = 0;
      const target = Math.floor(PROCESSED_CACHE_MAX / 10);
      for (const k of completed) {
        completed.delete(k);
        if (++dropped >= target) break;
      }
    }
  }

  /**
   * Decode and hand a signature's events to `onEvent`, exactly once.
   *
   * A caller that arrives while the same signature is already being
   * dispatched joins that attempt and settles with it — so the catch-up pass
   * waits for a live dispatch to land instead of assuming it did, and inherits
   * its failure. Only a resolved dispatch is recorded as complete.
   */
  async function dispatch(
    programId: PublicKey,
    signature: string,
    slot: number,
    logs: string[],
  ): Promise<void> {
    const key = `${programId.toBase58()}:${signature}`;
    const running = dispatching.get(key);
    if (running) return running;
    if (completed.has(key)) return;

    // parseLogs stays INSIDE the promise body: a truncated or version-skewed
    // payload throws out of the decoder, and letting that escape an async
    // callback is an unhandled rejection (IDX-34).
    const work = (async () => {
      for (const event of parseLogs(logs)) {
        await opts.onEvent({ signature, slot, programId: programId.toBase58(), event });
      }
    })();
    dispatching.set(key, work);
    try {
      await work;
      markCompleted(key);
    } finally {
      dispatching.delete(key);
    }
  }

  /**
   * Page `getSignaturesForAddress` back to the stored cursor, replay the
   * decoded events oldest-first, and advance the cursor one slot at a time.
   * The cursor moves ONLY after the signature at that slot was dispatched
   * successfully, so a throw anywhere leaves the range to be re-read.
   */
  async function catchUpOne(programId: PublicKey): Promise<void> {
    if (!cursor) return;
    const key = programId.toBase58();

    const last = await cursor.get(key);
    let fromSlot = last;
    if (fromSlot === null) {
      const head = await opts.connection.getSlot(commitment);
      fromSlot = Math.max(0, head - maxColdStartSlots);
      console.log(
        `[solana-listener] ${key}: cold start, scanning from slot ${fromSlot} (head ${head})`,
      );
    }

    const pending: Array<{ signature: string; slot: number; err: unknown }> = [];
    let before: string | undefined;
    let truncated = false;

    while (!stopped) {
      const page = await opts.connection.getSignaturesForAddress(
        programId,
        { before, limit: SIGNATURE_PAGE_SIZE },
        commitment,
      );
      if (page.length === 0) break;

      let reachedCursor = false;
      for (const info of page) {
        if (info.slot < fromSlot) {
          reachedCursor = true;
          break;
        }
        pending.push({ signature: info.signature, slot: info.slot, err: info.err });
        if (pending.length >= maxCatchUpSignatures) {
          truncated = true;
          break;
        }
      }
      if (reachedCursor || truncated) break;
      before = page[page.length - 1].signature;
    }

    if (stopped) return;

    if (pending.length === 0) {
      // Nothing new. Persist the cold-start floor so the next pass doesn't
      // re-derive it from a moving head.
      if (last === null) await cursor.set(key, fromSlot);
      return;
    }

    pending.reverse(); // oldest → newest

    if (truncated) {
      const gapTo = pending[0].slot - 1;
      console.error(
        `[solana-listener] ${key}: catch-up truncated at ${maxCatchUpSignatures} signatures — ` +
          `slots ${fromSlot}-${gapTo} were never scanned; run a manual backfill`,
      );
      await cursor.recordGap(key, fromSlot, gapTo);
    }

    for (const item of pending) {
      if (stopped) return;

      if (item.err) {
        // Failed on-chain transaction — nothing was emitted, but the slot is
        // accounted for.
        await cursor.set(key, item.slot);
        continue;
      }

      const tx = await opts.connection.getTransaction(item.signature, {
        commitment,
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) {
        // Not yet queryable at this commitment (or pruned). Stop the pass
        // with the cursor behind it rather than skipping the slot.
        console.warn(
          `[solana-listener] ${key}: transaction ${item.signature} not available at ` +
            `'${commitment}' commitment; stopping catch-up at slot ${item.slot}`,
        );
        return;
      }
      if (tx.meta?.err) {
        await cursor.set(key, item.slot);
        continue;
      }

      await dispatch(programId, item.signature, item.slot, tx.meta?.logMessages ?? []);
      await cursor.set(key, item.slot);
    }
  }

  async function catchUp(): Promise<void> {
    for (const programId of opts.programIds) {
      if (stopped) return;
      try {
        await catchUpOne(programId);
      } catch (err) {
        // Cursor was not advanced past the failure — the next pass re-reads
        // the same range. Loud, but not fatal to the other programs.
        console.error(
          `[solana-listener] catch-up for ${programId.toBase58()} failed (cursor not advanced):`,
          err,
        );
      }
    }
  }

  function scheduleCatchUp(): void {
    if (stopped || !cursor) return;
    timer = setTimeout(() => {
      inFlight = catchUp().then(() => {
        scheduleCatchUp();
      });
      void inFlight;
    }, catchUpIntervalMs);
  }

  if (!cursor) {
    console.warn(
      "[solana-listener] no slot cursor configured — events emitted while this process is " +
        "down or reconnecting will NOT be recovered",
    );
  }

  // Backfill before installing the live subscription so nothing emitted while
  // we were down is missed. The repeating pass afterwards covers the window
  // where the WebSocket drops and web3.js silently reconnects without replay.
  inFlight = catchUp();
  await inFlight;

  for (const programId of opts.programIds) {
    const id = opts.connection.onLogs(
      programId,
      (logs: Logs, ctx) => {
        if (logs.err) return;
        // Live delivery is a latency optimisation only. The durable cursor is
        // advanced exclusively by the catch-up pass, which is the only path
        // that has enumerated a contiguous slot range; a failure here is
        // retried there.
        void dispatch(programId, logs.signature, ctx.slot, logs.logs).catch((err) =>
          console.error("[solana-listener] live dispatch threw:", err),
        );
      },
      commitment,
    );
    subIds.push(id);
  }

  scheduleCatchUp();

  console.log(
    `[solana-listener] watching ${opts.programIds.length} program(s) at '${commitment}' commitment ` +
      `(catch-up every ${catchUpIntervalMs}ms)`,
  );

  return {
    catchUp,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Drain an in-flight catch-up so the cursor isn't left mid-range.
      await inFlight.catch((err) =>
        console.error("[solana-listener] in-flight catch-up failed during shutdown:", err),
      );
      for (const id of subIds) {
        try {
          await opts.connection.removeOnLogsListener(id);
        } catch (err) {
          console.warn(
            "[solana-listener] removeOnLogsListener failed (connection likely already closed):",
            err,
          );
        }
      }
    },
  };
}
