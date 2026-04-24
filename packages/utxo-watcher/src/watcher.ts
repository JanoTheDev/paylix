/**
 * High-level UTXO watcher service. Consumes active checkout sessions,
 * subscribes to their derived addresses via Electrum, accumulates credits
 * per session, and fires `onPayment` once the configured confirmation
 * threshold is reached.
 *
 * Runtime model: single Node process per chain × network pair, shares the
 * Postgres tables with the EVM indexer under `network_key='bitcoin'` (etc).
 */

import type { UtxoChainDescriptor } from "./descriptors";
import type { AddressPaymentHit, ElectrumClient } from "./electrum";

export interface WatcherSession {
  sessionId: string;
  address: string;
  expectedSats: bigint;
  expiresAt: Date;
}

export interface WatcherCallbacks {
  /** Fires when a session reaches the configured confirmation threshold. */
  onPayment(session: WatcherSession, hit: AddressPaymentHit): Promise<void>;
  /** Fires when a session reaches expiresAt without a matching tx. */
  onExpire(session: WatcherSession): Promise<void>;
  /**
   * Fires when a previously-confirmed payment tx is no longer present on
   * chain at its original height (reorg or orphan). Optional — callers that
   * don't provide it opt out of reorg monitoring. See #76.
   */
  onReorg?(sessionId: string, txid: string): Promise<void>;
}

export interface WatcherOptions {
  descriptor: UtxoChainDescriptor;
  client: ElectrumClient;
  /** Override the descriptor's default confirmation threshold. */
  confirmations?: number;
  callbacks: WatcherCallbacks;
  /** How often to sweep expired sessions (default 60s). */
  expireSweepMs?: number;
  /** How often to re-verify confirmed payments for reorgs (default 120s). */
  reorgCheckMs?: number;
  /**
   * Depth (in blocks past the original confirmation height) after which a
   * payment is considered final and removed from the reorg monitor. Default
   * 100 blocks (~16h on BTC) — well beyond any plausible reorg.
   */
  reorgWindowBlocks?: number;
}

export interface WatcherHandle {
  watch(session: WatcherSession): Promise<void>;
  unwatch(sessionId: string): Promise<void>;
  stop(): Promise<void>;
}

interface WatchedSession extends WatcherSession {
  unsubscribe: () => void;
  firedFor: Set<string>; // txids we've already reported
}

interface ReorgWatch {
  sessionId: string;
  txid: string;
  originalHeight: number;
}

class WatcherService implements WatcherHandle {
  private sessions = new Map<string, WatchedSession>();
  private expireInterval: NodeJS.Timeout | null = null;
  private reorgInterval: NodeJS.Timeout | null = null;
  private reorgWatches = new Map<string, ReorgWatch>(); // keyed by sessionId
  private stopped = false;
  private readonly confirmations: number;
  private readonly reorgWindowBlocks: number;

  constructor(private opts: WatcherOptions) {
    this.confirmations = opts.confirmations ?? opts.descriptor.defaultConfirmations;
    this.reorgWindowBlocks = opts.reorgWindowBlocks ?? 100;
    const sweepMs = opts.expireSweepMs ?? 60_000;
    this.expireInterval = setInterval(() => void this.sweepExpired(), sweepMs);
    if (opts.callbacks.onReorg) {
      const reorgMs = opts.reorgCheckMs ?? 120_000;
      this.reorgInterval = setInterval(() => void this.checkReorgs(), reorgMs);
    }
  }

  async watch(session: WatcherSession): Promise<void> {
    if (this.stopped) throw new Error("Watcher stopped");
    if (this.sessions.has(session.sessionId)) return;

    const firedFor = new Set<string>();
    const unsubscribe = await this.opts.client.subscribeAddress(
      session.address,
      async (hit) => {
        if (hit.confirmations < this.confirmations) return;
        if (hit.valueSats < session.expectedSats) return;
        if (firedFor.has(hit.txid)) return;
        firedFor.add(hit.txid);

        try {
          await this.opts.callbacks.onPayment(session, hit);
          if (this.opts.callbacks.onReorg) {
            this.reorgWatches.set(session.sessionId, {
              sessionId: session.sessionId,
              txid: hit.txid,
              originalHeight: hit.blockHeight,
            });
          }
        } finally {
          // Once we've reported the payment, stop watching this address —
          // never reuse, never double-credit.
          await this.unwatch(session.sessionId).catch(() => {});
        }
      },
    );

    this.sessions.set(session.sessionId, {
      ...session,
      unsubscribe,
      firedFor,
    });
  }

  async unwatch(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.unsubscribe();
    this.sessions.delete(sessionId);
  }

  private async checkReorgs(): Promise<void> {
    if (this.stopped || !this.opts.callbacks.onReorg) return;
    if (this.reorgWatches.size === 0) return;
    const tip = await this.opts.client.getTipHeight().catch(() => 0);
    for (const watch of [...this.reorgWatches.values()]) {
      const currentHeight = await this.opts.client
        .getTransactionHeight(watch.txid)
        .catch(() => undefined);
      // undefined = transient lookup failure; retry next cycle.
      if (currentHeight === undefined) continue;
      if (currentHeight === null || currentHeight !== watch.originalHeight) {
        // Dropped from chain or rehomed to a different block — reorg.
        this.reorgWatches.delete(watch.sessionId);
        try {
          await this.opts.callbacks.onReorg!(watch.sessionId, watch.txid);
        } catch {
          // Swallow — don't let one reorg callback block others.
        }
        continue;
      }
      // Finalized past the reorg window? Drop from monitor.
      if (tip && tip - currentHeight >= this.reorgWindowBlocks) {
        this.reorgWatches.delete(watch.sessionId);
      }
    }
  }

  private async sweepExpired(): Promise<void> {
    if (this.stopped) return;
    const now = Date.now();
    const expired: WatchedSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.expiresAt.getTime() < now) expired.push(s);
    }
    for (const s of expired) {
      try {
        await this.opts.callbacks.onExpire(s);
      } catch {
        // Don't let one merchant callback failure block sweeping others.
      }
      await this.unwatch(s.sessionId).catch(() => {});
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.expireInterval) clearInterval(this.expireInterval);
    if (this.reorgInterval) clearInterval(this.reorgInterval);
    for (const s of this.sessions.values()) s.unsubscribe();
    this.sessions.clear();
    this.reorgWatches.clear();
    await this.opts.client.close();
  }
}

export function startWatcher(opts: WatcherOptions): WatcherHandle {
  return new WatcherService(opts);
}
