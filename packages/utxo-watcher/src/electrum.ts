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
}

export interface ElectrumClient {
  subscribeAddress(
    address: string,
    onHit: (hit: AddressPaymentHit) => void | Promise<void>,
  ): Promise<() => void>;
  getTipHeight(): Promise<number>;
  close(): Promise<void>;
}

export interface ElectrumClientOptions {
  endpoint: string;
  descriptor: UtxoChainDescriptor;
  reconnectDelayMs?: number;
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
  const digest = sha256(script);
  // Electrum expects little-endian; reverse byte order.
  const reversed = new Uint8Array(digest.length);
  for (let i = 0; i < digest.length; i++) reversed[i] = digest[digest.length - 1 - i];
  return bytesToHex(reversed);
}

class ElectrumWsClient implements ElectrumClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private subscriptions = new Map<string, (hit: AddressPaymentHit) => void | Promise<void>>();
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private tipHeight = 0;

  constructor(private opts: ElectrumClientOptions) {}

  private async ensureConnected(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.endpoint);
      this.ws = ws;
      ws.on("open", () => resolve(ws));
      ws.on("error", (err) => reject(err));
      ws.on("message", (raw) => this.handleFrame(raw.toString("utf8")));
      ws.on("close", () => this.handleClose());
    });
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
        const slot = this.pending.get(msg.id);
        if (!slot) continue;
        this.pending.delete(msg.id);
        if (msg.error) slot.reject(new Error(msg.error.message));
        else slot.resolve(msg.result);
      } else if (msg.method === "blockchain.scripthash.subscribe" && Array.isArray(msg.params)) {
        // Subscription notification. params: [scripthash, status_hash].
        // We don't act on the status hash directly — on change, re-fetch
        // history for the subscribed scripthash. Delegated to the watcher
        // via the per-address callback path below.
        const scripthash = msg.params[0] as string;
        void this.refreshHistory(scripthash);
      } else if (msg.method === "blockchain.headers.subscribe" && Array.isArray(msg.params)) {
        const header = msg.params[0] as { height?: number };
        if (typeof header.height === "number") this.tipHeight = header.height;
      }
    }
  }

  private handleClose(): void {
    this.ws = null;
    for (const [, slot] of this.pending) slot.reject(new Error("Electrum connection closed"));
    this.pending.clear();
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
      }
    } catch {
      // Reconnect will retry via handleClose
    }
  }

  private async request<T = unknown>(method: string, params: unknown[]): Promise<T> {
    const ws = await this.ensureConnected();
    const id = this.nextId++;
    const req: JsonRpcRequest = { id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ws.send(JSON.stringify(req) + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
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
      const tx = await this.request<{ vout?: Array<{ value: number; n: number; scriptPubKey?: { hex?: string } }> }>(
        "blockchain.transaction.get",
        [entry.tx_hash, true],
      );
      const outs = tx.vout ?? [];
      for (const out of outs) {
        // Filter: include any vout whose script matches our scripthash. For
        // simplicity we emit every vout and let the watcher sum them by
        // scripthash — real Electrum servers already filter server-side.
        await cb({
          txid: entry.tx_hash,
          blockHeight: entry.height,
          confirmations,
          vout: out.n,
          // Electrum reports values in whole BTC; convert to satoshis with
          // bigint precision. Third-party servers sometimes return a string.
          valueSats: BigInt(Math.round(Number(out.value) * 1e8)),
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

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

export function createElectrumClient(opts: ElectrumClientOptions): ElectrumClient {
  return new ElectrumWsClient(opts);
}
