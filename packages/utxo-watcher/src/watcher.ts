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
   * Fires once per transaction that confirms to a watched address for less
   * than the session's expected amount. Optional — without it the shortfall
   * is only logged. See IDX-33.
   */
  onUnderpayment?(
    session: WatcherSession,
    hit: AddressPaymentHit,
    shortfallSats: bigint,
  ): Promise<void>;
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
  firedFor: Set<string>; // txids we've already reported successfully
  shortfallReported: Set<string>; // txids we've already flagged as underpaid
}

interface ReorgWatch {
  sessionId: string;
  txid: string;
  originalHeight: number;
  /**
   * Block that contained the tx when we credited it. Undefined when the
   * backend doesn't report one, in which case only "in no block at all"
   * counts as a reorg — rehoming can't be detected without it, and guessing
   * from heights is what destroyed confirmed payments (IDX-09).
   */
  originalBlockHash?: string;
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

    const entry: WatchedSession = {
      ...session,
      unsubscribe: () => {},
      firedFor: new Set<string>(),
      shortfallReported: new Set<string>(),
    };
    // Register before subscribing: the Electrum client reconciles the current
    // chain state as part of subscribeAddress, so a hit can arrive before it
    // resolves and unwatch() must be able to find this session.
    this.sessions.set(session.sessionId, entry);

    let unsubscribe: () => void;
    try {
      unsubscribe = await this.opts.client.subscribeAddress(session.address, (hit) =>
        this.handleHit(entry, hit),
      );
    } catch (err) {
      this.sessions.delete(session.sessionId);
      throw err;
    }

    entry.unsubscribe = unsubscribe;
    if (this.sessions.get(session.sessionId) !== entry) {
      // Already resolved (paid or expired) while we were subscribing — tear
      // the subscription down now that we finally have its handle.
      unsubscribe();
    }
  }

  /**
   * Single entry point for address activity. Nothing here is allowed to
   * throw: it is invoked from the Electrum client's notification path, where
   * an escaping rejection is unhandled and can terminate the process.
   */
  private async handleHit(entry: WatchedSession, hit: AddressPaymentHit): Promise<void> {
    try {
      if (hit.confirmations < this.confirmations) return;
      if (entry.firedFor.has(hit.txid)) return;

      if (hit.valueSats < entry.expectedSats) {
        // Discarding this silently leaves the buyer's funds at a single-use
        // address with nothing in the logs or DB explaining why the session
        // expired unpaid — see IDX-33.
        if (entry.shortfallReported.has(hit.txid)) return;
        entry.shortfallReported.add(hit.txid);
        const shortfall = entry.expectedSats - hit.valueSats;
        console.warn(
          `[utxo-watcher] session=${entry.sessionId} tx=${hit.txid} underpaid by ${shortfall} sats ` +
            `(received ${hit.valueSats}, expected ${entry.expectedSats})`,
        );
        if (this.opts.callbacks.onUnderpayment) {
          try {
            await this.opts.callbacks.onUnderpayment(entry, hit, shortfall);
          } catch (err) {
            console.error(
              `[utxo-watcher] onUnderpayment for session=${entry.sessionId} failed:`,
              err,
            );
          }
        }
        return;
      }

      try {
        await this.opts.callbacks.onPayment(entry, hit);
      } catch (err) {
        // The payment was NOT recorded. Leave the txid unmarked and the
        // address subscribed so the next notification retries it — marking
        // it fired here loses the payment permanently (IDX-18).
        console.error(
          `[utxo-watcher] onPayment for session=${entry.sessionId} tx=${hit.txid} failed; ` +
            `leaving the address watched for retry:`,
          err,
        );
        return;
      }

      entry.firedFor.add(hit.txid);
      if (this.opts.callbacks.onReorg) {
        this.reorgWatches.set(entry.sessionId, {
          sessionId: entry.sessionId,
          txid: hit.txid,
          originalHeight: hit.blockHeight,
          originalBlockHash: hit.blockHash,
        });
      }
      // Only now that the payment is recorded do we stop watching this
      // address — never reuse, never double-credit.
      await this.unwatch(entry.sessionId);
    } catch (err) {
      console.error(`[utxo-watcher] hit handling for session=${entry.sessionId} failed:`, err);
    }
  }

  async unwatch(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    this.sessions.delete(sessionId);
    try {
      entry.unsubscribe();
    } catch (err) {
      console.error(`[utxo-watcher] unsubscribe for session=${sessionId} failed:`, err);
    }
  }

  private async checkReorgs(): Promise<void> {
    if (this.stopped || !this.opts.callbacks.onReorg) return;
    if (this.reorgWatches.size === 0) return;
    const tip = await this.opts.client.getTipHeight().catch((err) => {
      console.warn("[utxo-watcher] tip lookup failed during reorg check:", err);
      return 0;
    });
    for (const watch of [...this.reorgWatches.values()]) {
      const currentBlockHash = await this.opts.client
        .getTransactionBlockHash(watch.txid)
        .catch((err) => {
          console.warn(
            `[utxo-watcher] block lookup for ${watch.txid} threw; retrying next cycle:`,
            err,
          );
          return undefined;
        });
      // undefined = transient lookup failure; retry next cycle. Never treat
      // it as a reorg — onReorg deletes the payment row (IDX-09).
      if (currentBlockHash === undefined) continue;
      // Exact block identity: no height arithmetic, so the tip advancing
      // mid-request can never be mistaken for a reorg.
      //
      // If the backend never reported a blockhash, `originalBlockHash` is
      // undefined and detection degrades to drop-only: we still catch a tx
      // that left the chain, but not one rehomed into a different block. That
      // is the safe direction — a rehomed transaction is still a valid
      // payment, whereas a dropped one is the double-spend case — and it is
      // strictly better than guessing from heights, which deleted confirmed
      // payments outright.
      const rehomed =
        watch.originalBlockHash !== undefined && currentBlockHash !== watch.originalBlockHash;
      if (currentBlockHash === null || rehomed) {
        // Dropped from chain or rehomed to a different block — reorg.
        try {
          await this.opts.callbacks.onReorg!(watch.sessionId, watch.txid);
          // Drop the watch only once the revert actually landed, otherwise a
          // failed callback leaves an orphaned payment row forever (IDX-42).
          this.reorgWatches.delete(watch.sessionId);
        } catch (err) {
          console.error(
            `[utxo-watcher] onReorg for session=${watch.sessionId} tx=${watch.txid} failed; ` +
              `will retry next cycle:`,
            err,
          );
        }
        continue;
      }
      // Still in the same block, so it is still at originalHeight. Finalized
      // past the reorg window? Drop from monitor. A stale tip only delays
      // this, which is harmless.
      if (tip && tip - watch.originalHeight >= this.reorgWindowBlocks) {
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
      } catch (err) {
        // Don't let one merchant callback failure block sweeping others, but
        // never lose the reason.
        console.error(`[utxo-watcher] onExpire for session=${s.sessionId} failed:`, err);
      }
      await this.unwatch(s.sessionId);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.expireInterval) clearInterval(this.expireInterval);
    if (this.reorgInterval) clearInterval(this.reorgInterval);
    for (const s of this.sessions.values()) {
      try {
        s.unsubscribe();
      } catch (err) {
        console.error(`[utxo-watcher] unsubscribe for session=${s.sessionId} failed:`, err);
      }
    }
    this.sessions.clear();
    this.reorgWatches.clear();
    await this.opts.client.close();
  }
}

export function startWatcher(opts: WatcherOptions): WatcherHandle {
  return new WatcherService(opts);
}
