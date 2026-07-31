import { sleep as defaultSleep, withChunkRetry } from "./rpc-retry";

export interface ProcessWindowResult {
  totalLogs: number;
  /** Last block whose logs are durably accounted for. */
  lastProcessed: bigint;
  /** True when the window stopped early without covering [from, to]. */
  aborted: boolean;
}

export interface ProcessWindowDeps<TLog> {
  /** Cursor key, for logs. */
  key: string;
  /** "backfill" | "live", for logs. */
  label: string;
  eventName: string;
  chunkSize: bigint;
  delayMs: number;
  isStopped: () => boolean;
  getLogs: (fromBlock: bigint, toBlock: bigint) => Promise<TLog[]>;
  handle: (log: TLog) => Promise<void>;
  /**
   * Retains a log whose handler threw so the retry sweep can replay it.
   * Returning false means the event is NOT durably recorded anywhere, and the
   * window must stop without advancing.
   */
  retain: (log: TLog) => Promise<boolean>;
  setLastBlock: (block: bigint) => Promise<void>;
  describeLog?: (log: TLog) => string;
  maxChunkAttempts?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Processes a [fromBlock, toBlock] window in chunks, advancing the cursor ONLY
 * past work that is durably accounted for.
 *
 * The two rules this function exists to enforce:
 *  1. A chunk we could not read never advances the cursor. Advancing on a
 *     transient RPC error silently skips a block range forever.
 *  2. A log whose handler threw advances the cursor only if it was retained in
 *     unmatched_events. Otherwise the window stops so the range is re-read.
 *
 * Handlers are idempotent (txHash pre-checks), so re-reading a range is safe;
 * skipping one is not.
 */
export async function processWindow<TLog>(
  deps: ProcessWindowDeps<TLog>,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ProcessWindowResult> {
  const {
    key,
    label,
    eventName,
    chunkSize,
    delayMs,
    isStopped,
    getLogs,
    handle,
    retain,
    setLastBlock,
    describeLog = () => "",
    maxChunkAttempts = 3,
    sleepFn = defaultSleep,
  } = deps;

  let totalLogs = 0;
  let cursor = fromBlock;
  let lastProcessed = fromBlock - 1n;
  let aborted = false;

  while (cursor <= toBlock) {
    if (isStopped()) break;

    const chunkEnd =
      cursor + chunkSize - 1n > toBlock ? toBlock : cursor + chunkSize - 1n;

    let logs: TLog[];
    try {
      const chunkStart = cursor;
      logs = await withChunkRetry(
        () => getLogs(chunkStart, chunkEnd),
        `${key} ${chunkStart}-${chunkEnd}`,
        { maxAttempts: maxChunkAttempts, isStopped, sleepFn },
      );
    } catch (err) {
      console.error(
        `[Listener] Chunk ${cursor}-${chunkEnd} failed for ${key}, stopping ${label} for this contract (cursor left at ${cursor - 1n}):`,
        err instanceof Error ? err.message : err
      );
      aborted = true;
      break;
    }

    totalLogs += logs.length;

    let chunkAborted = false;
    for (const log of logs) {
      try {
        await handle(log);
      } catch (err) {
        console.error(`[Listener] Error handling ${label} ${eventName}:`, err);
        const retained = await retain(log);
        if (!retained) {
          console.error(
            `[Listener] Could not retain failed ${eventName} (${describeLog(log)}); ` +
              `stopping ${label} for ${key} with the cursor at ${cursor - 1n} so the range is re-read`
          );
          chunkAborted = true;
          break;
        }
      }
    }
    if (chunkAborted) {
      aborted = true;
      break;
    }

    await setLastBlock(chunkEnd);
    lastProcessed = chunkEnd;

    cursor = chunkEnd + 1n;
    if (delayMs > 0) await sleepFn(delayMs);
  }

  return { totalLogs, lastProcessed, aborted };
}
