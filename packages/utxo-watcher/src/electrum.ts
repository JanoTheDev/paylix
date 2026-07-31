/**
 * Electrum protocol client. SPV — the watcher never runs a full node; it
 * subscribes to a third-party Electrum gateway for address activity.
 *
 * Self-hosters who need full sovereignty can point `endpoint` at their own
 * electrs / fulcrum server. The default in `descriptors.ts` is a
 * publicly-hosted Blockstream endpoint that works out of the box.
 *
 * Transport: line-framed JSON-RPC 2.0 over WebSocket. Electrum servers
 * accept newline-separated JSON frames; `ws` Node clients preserve that.
 */

import type { UtxoChainDescriptor } from "./descriptors";
import WebSocket from "ws";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as bitcoin from "bitcoinjs-lib";

export interface ElectrumHistoryEntry {
  tx_hash: string;
  height: number;
  fee?: number;
}

export interface AddressPaymentHit {
  txid: string;
  blockHeight: number;
  confirmations: number;
  vout: number;
  valueSats: bigint;
  /**
   * Hash of the block containing this transaction, when the backend supplies
   * it. The reorg monitor compares this exact value later instead of deriving
   * a height, which is the only way to tell "rehomed by a reorg" from "the tip
   * advanced while we were asking" — see IDX-09.
   */
  blockHash?: string;
}

export interface ElectrumClient {
  subscribeAddress(
    address: string,
    onHit: (hit: AddressPaymentHit) => void | Promise<void>,
  ): Promise<() => void>;
  getTipHeight(): Promise<number>;
  /**
   * Hash of the block currently containing `txid`. Three-state contract,
   * relied on by `watcher.checkReorgs`:
   *   string    — the tx is in this block right now
   *   null      — the server explicitly says the tx is in no block
   *               (dropped, reorged out, or never confirmed)
   *   undefined — transient lookup failure; retry next cycle
   *
   * `null` deletes the payment row, so a connection drop, timeout or server
   * error MUST return undefined, never null — see IDX-09.
   *
   * This deliberately reports a hash, not a height. The previous height form
   * was derived as `tip - confirmations + 1`, mixing a server-side count with
   * a locally cached tip read after the response: a block arriving during the
   * round trip shifted the result by one and the caller destroyed a confirmed
   * payment. A block hash is a single authoritative value with no arithmetic.
   */
  getTransactionBlockHash(txid: string): Promise<string | null | undefined>;
  close(): Promise<void>;
}

export interface ElectrumClientOptions {
  endpoint: string;
  descriptor: UtxoChainDescriptor;
  reconnectDelayMs?: number;
  /** Per-request timeout in ms (default 30s). */
  requestTimeoutMs?: number;
}

interface JsonRpcRequest {
  id: number;
  method: string;
  params: unknown[];
}

interface JsonRpcResponse {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
  params?: unknown[];
}

/**
 * Derive the Electrum scripthash for an address. Electrum indexes addresses
 * by the SHA-256 of the output script (reversed to little-endian hex).
 */
export function addressToScriptHash(
  address: string,
  descriptor: UtxoChainDescriptor,
): string {
  const network: bitcoin.networks.Network = {
    messagePrefix: descriptor.network.messagePrefix,
    bech32: descriptor.network.bech32,
    bip32: descriptor.network.bip32,
    pubKeyHash: descriptor.network.pubKeyHash,
    scriptHash: descriptor.network.scriptHash,
    wif: descriptor.network.wif,
  };
  const script = bitcoin.address.toOutputScript(address, network);
  return scriptToElectrumScripthash(script);
}

function scriptToElectrumScripthash(script: Uint8Array): string {
  const digest = sha256(script);
  // Electrum expects little-endian; reverse byte order.
  const reversed = new Uint8Array(digest.length);
  for (let i = 0; i < digest.length; i++) reversed[i] = digest[digest.length - 1 - i];
  return bytesToHex(reversed);
}

/** Hash a raw scriptPubKey hex string to its Electrum scripthash. */
export function hashScriptToElectrumScripthash(scriptHex: string): string {
  const clean = scriptHex.startsWith("0x") ? scriptHex.slice(2) : scriptHex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return scriptToElectrumScripthash(bytes);
}

/**
 * Convert a decimal BTC amount (possibly a string from verbose Electrum
 * responses) to satoshis without losing precision. Avoids the IEEE-754
 * rounding that `Number(x) * 1e8` introduces for large outputs.
 */
export function btcStringToSats(value: number | string): bigint {
  const raw = typeof value === "string" ? value : value.toFixed(8);
  const [whole, frac = ""] = raw.split(".");
  const padded = (frac + "00000000").slice(0, 8);
  const sign = whole.startsWith("-") ? -1n : 1n;
  const absWhole = whole.replace(/^-/, "") || "0";
  return sign * (BigInt(absWhole) * 100_000_000n + BigInt(padded || "0"));
}

/** Marker for a JSON-RPC error the server actually answered with. */
class ElectrumRpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = "ElectrumRpcError";
  }
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: NodeJS.Timeout;
}

class ElectrumWsClient implements ElectrumClient {
  private ws: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private subscriptions = new Map<string, (hit: AddressPaymentHit) => void | Promise<void>>();
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private tipHeight = 0;

  constructor(private opts: ElectrumClientOptions) {}

  private async ensureConnected(): Promise<WebSocket> {
    if (this.closed) throw new Error("Electrum client closed");
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;
    // Share one in-flight connect. Without this, a caller arriving while the
    // socket is still CONNECTING opens a second WebSocket and orphans the
    // first with its handlers still attached — see IDX-32.
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.opts.endpoint);
      this.ws = ws;
      ws.on("open", () => resolve(ws));
      ws.on("error", (err) => reject(err));
      ws.on("message", (raw) => this.handleFrame(raw.toString("utf8")));
      ws.on("close", () => this.handleClose());
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  private settlePending(id: number): PendingRequest | undefined {
    const slot = this.pending.get(id);
    if (!slot) return undefined;
    clearTimeout(slot.timer);
    this.pending.delete(id);
    return slot;
  }

  private rejectAllPending(reason: Error): void {
    for (const [id] of [...this.pending]) {
      this.settlePending(id)?.reject(reason);
    }
    this.pending.clear();
  }

  private handleFrame(raw: string): void {
    // Electrum can batch multiple JSON objects per message, newline-separated.
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue;
      }
      if (msg.id !== undefined) {
        const slot = this.settlePending(msg.id);
        if (!slot) continue;
        if (msg.error) slot.reject(new ElectrumRpcError(msg.error.message, msg.error.code));
        else slot.resolve(msg.result);
      } else if (msg.method === "blockchain.scripthash.subscribe" && Array.isArray(msg.params)) {
        // Subscription notification. params: [scripthash, status_hash].
        // We don't act on the status hash directly — on change, re-fetch
        // history for the subscribed scripthash. Delegated to the watcher
        // via the per-address callback path below.
        const scripthash = msg.params[0] as string;
        this.refreshHistorySafely(scripthash);
      } else if (msg.method === "blockchain.headers.subscribe" && Array.isArray(msg.params)) {
        const header = msg.params[0] as { height?: number };
        if (typeof header.height === "number") this.tipHeight = header.height;
      }
    }
  }

  private handleClose(): void {
    this.ws = null;
    this.rejectAllPending(new Error("Electrum connection closed"));
    if (this.closed) return;
    const delay = this.opts.reconnectDelayMs ?? 2000;
    this.reconnectTimer = setTimeout(() => {
      void this.reconnectAndResubscribe();
    }, delay);
  }

  private async reconnectAndResubscribe(): Promise<void> {
    if (this.closed) return;
    try {
      await this.ensureConnected();
      await this.request("blockchain.headers.subscribe", []);
      for (const scripthash of this.subscriptions.keys()) {
        await this.request("blockchain.scripthash.subscribe", [scripthash]);
        // Reconcile against the current chain state instead of waiting for a
        // status-hash change that will never come on a single-use address —
        // anything that landed during the outage is credited now (IDX-10).
        await this.refreshHistory(scripthash);
      }
    } catch (err) {
      // handleClose schedules the next attempt; log so a permanently broken
      // endpoint isn't silent.
      console.error("[electrum] reconnect/resubscribe failed:", err);
    }
  }

  private async request<T = unknown>(method: string, params: unknown[]): Promise<T> {
    const ws = await this.ensureConnected();
    const id = this.nextId++;
    const req: JsonRpcRequest = { id, method, params };
    const timeoutMs = this.opts.requestTimeoutMs ?? 30_000;
    return new Promise<T>((resolve, reject) => {
      // A server that accepts the frame and never answers would otherwise
      // leave this promise unsettled forever and leak the pending entry.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Electrum request '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      ws.send(JSON.stringify(req) + "\n", (err) => {
        if (err) {
          this.settlePending(id);
          reject(err);
        }
      });
    });
  }

  /**
   * Fire-and-forget wrapper for the notification path. `refreshHistory`
   * awaits two requests that reject on connection close or a server error;
   * letting that escape a synchronous frame handler is an unhandled
   * rejection, which crash-loops the daemon — see IDX-19.
   */
  private refreshHistorySafely(scripthash: string): void {
    void this.refreshHistory(scripthash).catch((err) =>
      console.error(`[electrum] history refresh for ${scripthash} failed:`, err),
    );
  }

  private async refreshHistory(scripthash: string): Promise<void> {
    const cb = this.subscriptions.get(scripthash);
    if (!cb) return;
    const history = (await this.request<ElectrumHistoryEntry[]>(
      "blockchain.scripthash.get_history",
      [scripthash],
    )) ?? [];
    const tip = this.tipHeight || (await this.getTipHeight());
    for (const entry of history) {
      if (entry.height <= 0) continue; // mempool only
      const confirmations = Math.max(0, tip - entry.height + 1);
      const tx = await this.request<{
        blockhash?: string;
        vout?: Array<{ value: number | string; n: number; scriptPubKey?: { hex?: string } }>;
      }>("blockchain.transaction.get", [entry.tx_hash, true]);
      const outs = tx.vout ?? [];
      for (const out of outs) {
        // Only emit vouts whose scriptPubKey hashes to the scripthash we
        // subscribed to. Without this check any tx containing a vout of the
        // right value could be attributed to an unrelated session — see
        // issue #72.
        const scriptHex = out.scriptPubKey?.hex;
        if (!scriptHex) continue;
        if (hashScriptToElectrumScripthash(scriptHex) !== scripthash) continue;
        await cb({
          txid: entry.tx_hash,
          blockHeight: entry.height,
          confirmations,
          vout: out.n,
          // Convert decimal BTC to satoshis via string arithmetic. Routing
          // through Number() loses precision for large outputs or dust —
          // see issue #75.
          valueSats: btcStringToSats(out.value),
          // Captured now so the reorg monitor can compare exact block
          // identity later instead of re-deriving a height (IDX-09).
          blockHash: tx.blockhash,
        });
      }
    }
  }

  async subscribeAddress(
    address: string,
    onHit: (hit: AddressPaymentHit) => void | Promise<void>,
  ): Promise<() => void> {
    const scripthash = addressToScriptHash(address, this.opts.descriptor);
    this.subscriptions.set(scripthash, onHit);
    await this.ensureConnected();
    await this.request("blockchain.headers.subscribe", []);
    await this.request("blockchain.scripthash.subscribe", [scripthash]);
    // The subscribe response carries the address's *current* status hash, and
    // push notifications only fire on a *change*. Reconcile the current chain
    // state explicitly, otherwise funds that arrived before this process
    // started are never credited on a single-use address — see IDX-10.
    await this.refreshHistory(scripthash);
    return () => {
      this.subscriptions.delete(scripthash);
    };
  }

  async getTipHeight(): Promise<number> {
    if (this.tipHeight) return this.tipHeight;
    const res = await this.request<{ height: number }>("blockchain.headers.subscribe", []);
    if (typeof res?.height === "number") {
      this.tipHeight = res.height;
      return res.height;
    }
    return 0;
  }

  /**
   * `null` is what makes the caller delete a confirmed payment row, so it is
   * reserved for an explicit server answer that the tx is in no block.
   * Everything else — connection closed, timeout, server error — is
   * `undefined`, meaning "retry next cycle". See IDX-09.
   */
  async getTransactionBlockHash(txid: string): Promise<string | null | undefined> {
    let tx: { confirmations?: number; blockhash?: string };
    try {
      tx = await this.request<{ confirmations?: number; blockhash?: string }>(
        "blockchain.transaction.get",
        [txid, true],
      );
    } catch (err) {
      if (err instanceof ElectrumRpcError && /missing|not found|no such/i.test(err.message)) {
        // The server answered: this transaction does not exist.
        return null;
      }
      console.warn(`[electrum] transaction lookup for ${txid} failed, retrying next cycle:`, err);
      return undefined;
    }

    if (!tx) return undefined;
    // No blockhash is the server stating the tx is unconfirmed or absent —
    // a genuine "not in a block". No arithmetic, no second clock.
    if (!tx.blockhash) return null;
    return tx.blockhash;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.subscriptions.clear();
    this.rejectAllPending(new Error("Electrum client closed"));
    this.ws?.close();
    this.ws = null;
  }
}

export function createElectrumClient(opts: ElectrumClientOptions): ElectrumClient {
  return new ElectrumWsClient(opts);
}
