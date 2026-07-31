/**
 * Service bridge — glues the watcher's Electrum subscription loop to an
 * outside data layer (typically Postgres via @paylix/db) without depending
 * on any specific database.
 *
 * The caller supplies three async functions:
 *   loadSessions   — returns active checkout sessions for this chain/network
 *   onPayment      — called when a watched address receives its expected value
 *   onExpire       — called when a session's expiresAt passes with no payment
 *
 * The bridge polls loadSessions on an interval, starts/updates/unwatches
 * sessions in the watcher, and forwards hits to onPayment. Decoupling the
 * DB lets us test with in-memory fixtures and lets operators plug in whatever
 * storage they use.
 */

import type { UtxoChainDescriptor } from "./descriptors";
import { deriveSessionAddress } from "./hd";
import type { AddressPaymentHit, ElectrumClient } from "./electrum";
import { startWatcher, type WatcherHandle, type WatcherSession } from "./watcher";

export interface BridgeSessionRow {
  sessionId: string;
  /** Merchant-level xpub/tpub string — per chain. */
  xpub: string;
  /** Pre-derived receive address. Null if derivation hasn't happened yet. */
  receiveAddress: string | null;
  /** Index used to derive the receive address. */
  sessionIndex: number | null;
  /** Expected payment amount in satoshis. */
  expectedSats: bigint;
  expiresAt: Date;
}

export interface BridgeCallbacks {
  /** Load active sessions needing a watch. Called every poll. */
  loadSessions(): Promise<BridgeSessionRow[]>;
  /** Persist a new derived address the first time we need one for a session. */
  persistDerivedAddress(sessionId: string, address: string, index: number): Promise<void>;
  /** Called when a payment matches. Writes the payment row + marks the session completed. */
  onPayment(sessionId: string, hit: AddressPaymentHit): Promise<void>;
  /** Called when a session expires without a payment. */
  onExpire(sessionId: string): Promise<void>;
  /**
   * Called once per confirmed transaction that pays a watched address less
   * than the session expects. Optional; the shortfall is logged either way.
   */
  onUnderpayment?(sessionId: string, hit: AddressPaymentHit, shortfallSats: bigint): Promise<void>;
  /**
   * Called when a previously-completed payment tx is no longer at its
   * original block height (reorg/orphan). Optional; callers that omit it
   * opt out of reorg monitoring.
   */
  onReorg?(sessionId: string, txid: string): Promise<void>;
  /**
   * Atomically reserves the next BIP44 session index for `xpub` and writes it
   * onto the `sessionId` row, so concurrent callers never receive the same
   * index. Returns the reserved index.
   */
  nextSessionIndex(xpub: string, sessionId: string): Promise<number>;
}

export interface BridgeOptions {
  descriptor: UtxoChainDescriptor;
  client: ElectrumClient;
  callbacks: BridgeCallbacks;
  /** Confirmation threshold override; defaults to descriptor.defaultConfirmations. */
  confirmations?: number;
  /** How often to re-read active sessions from storage (default 15s). */
  pollMs?: number;
  /** Passed through to the watcher — how often to re-check reorgs (default 120s). */
  reorgCheckMs?: number;
  /** Passed through to the watcher — reorg-window depth in blocks (default 100). */
  reorgWindowBlocks?: number;
}

export interface BridgeHandle {
  stop(): Promise<void>;
  /** Run one pass synchronously — exposed for tests. */
  tick(): Promise<void>;
}

export function startBridge(opts: BridgeOptions): BridgeHandle {
  const tracked = new Set<string>();
  const watcher: WatcherHandle = startWatcher({
    descriptor: opts.descriptor,
    client: opts.client,
    confirmations: opts.confirmations,
    reorgCheckMs: opts.reorgCheckMs,
    reorgWindowBlocks: opts.reorgWindowBlocks,
    callbacks: {
      onPayment: async (session: WatcherSession, hit: AddressPaymentHit) => {
        await opts.callbacks.onPayment(session.sessionId, hit);
        tracked.delete(session.sessionId);
      },
      onExpire: async (session: WatcherSession) => {
        await opts.callbacks.onExpire(session.sessionId);
        tracked.delete(session.sessionId);
      },
      onUnderpayment: opts.callbacks.onUnderpayment
        ? async (session: WatcherSession, hit: AddressPaymentHit, shortfallSats: bigint) => {
            await opts.callbacks.onUnderpayment!(session.sessionId, hit, shortfallSats);
          }
        : undefined,
      onReorg: opts.callbacks.onReorg
        ? async (sessionId: string, txid: string) => {
            await opts.callbacks.onReorg!(sessionId, txid);
          }
        : undefined,
    },
  });

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    const rows = await opts.callbacks.loadSessions();
    for (const row of rows) {
      if (tracked.has(row.sessionId)) continue;

      let address = row.receiveAddress;
      let index = row.sessionIndex;
      if (!address || index === null) {
        const nextIndex = await opts.callbacks.nextSessionIndex(row.xpub, row.sessionId);
        const derived = deriveSessionAddress(
          { key: row.xpub, descriptor: opts.descriptor },
          nextIndex,
        );
        address = derived.address;
        index = derived.sessionIndex;
        await opts.callbacks.persistDerivedAddress(row.sessionId, address, index);
      }

      await watcher.watch({
        sessionId: row.sessionId,
        address,
        expectedSats: row.expectedSats,
        expiresAt: row.expiresAt,
      });
      tracked.add(row.sessionId);
    }
  }

  function schedule(): void {
    if (stopped) return;
    const delay = opts.pollMs ?? 15_000;
    timer = setTimeout(async () => {
      try {
        await tick();
      } catch (err) {
        console.error("[utxo-bridge] tick failed:", err);
      }
      schedule();
    }, delay);
  }
  schedule();

  return {
    tick,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await watcher.stop();
    },
  };
}
