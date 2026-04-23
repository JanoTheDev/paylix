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
}

export interface WatcherOptions {
  descriptor: UtxoChainDescriptor;
  client: ElectrumClient;
  /** Override the descriptor's default confirmation threshold. */
  confirmations?: number;
  callbacks: WatcherCallbacks;
  /** How often to sweep expired sessions (default 60s). */
  expireSweepMs?: number;
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

class WatcherService implements WatcherHandle {
  private sessions = new Map<string, WatchedSession>();
  private expireInterval: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly confirmations: number;

  constructor(private opts: WatcherOptions) {
    this.confirmations = opts.confirmations ?? opts.descriptor.defaultConfirmations;
    const sweepMs = opts.expireSweepMs ?? 60_000;
    this.expireInterval = setInterval(() => void this.sweepExpired(), sweepMs);
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
    for (const s of this.sessions.values()) s.unsubscribe();
    this.sessions.clear();
    await this.opts.client.close();
  }
}

export function startWatcher(opts: WatcherOptions): WatcherHandle {
  return new WatcherService(opts);
}
