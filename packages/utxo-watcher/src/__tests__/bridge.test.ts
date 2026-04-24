import { describe, it, expect, vi } from "vitest";
import type { ElectrumClient, AddressPaymentHit } from "../electrum";
import { startBridge, type BridgeSessionRow } from "../bridge";
import { DESCRIPTORS } from "../descriptors";

const BITCOIN_TEST_XPUB =
  "xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj";

function makeFakeClient(): ElectrumClient & {
  _fire: (address: string, hit: AddressPaymentHit) => Promise<void>;
  _setTxHeight: (txid: string, height: number | null) => void;
} {
  const subs = new Map<string, (hit: AddressPaymentHit) => void | Promise<void>>();
  const txHeights = new Map<string, number | null>();
  return {
    async subscribeAddress(address, onHit) {
      subs.set(address, onHit);
      return () => { subs.delete(address); };
    },
    async getTipHeight() { return 1000; },
    async getTransactionHeight(txid) {
      return txHeights.has(txid) ? (txHeights.get(txid) ?? null) : null;
    },
    async close() {},
    async _fire(address, hit) {
      const cb = subs.get(address);
      if (cb) await cb(hit);
    },
    _setTxHeight(txid, height) { txHeights.set(txid, height); },
  };
}

describe("bridge", () => {
  it("derives address + starts watcher on tick, forwards payment hits", async () => {
    const persisted: Array<{ id: string; addr: string; idx: number }> = [];
    const paid: Array<{ id: string; hit: AddressPaymentHit }> = [];

    const session: BridgeSessionRow = {
      sessionId: "sess-1",
      xpub: BITCOIN_TEST_XPUB,
      receiveAddress: null,
      sessionIndex: null,
      expectedSats: 10_000n,
      expiresAt: new Date(Date.now() + 60_000),
    };

    const client = makeFakeClient();
    const handle = startBridge({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      pollMs: 3_600_000,
      confirmations: 2,
      callbacks: {
        loadSessions: async () => [session],
        persistDerivedAddress: async (id, addr, idx) => { persisted.push({ id, addr, idx }); },
        onPayment: async (id, hit) => { paid.push({ id, hit }); },
        onExpire: async () => {},
        nextSessionIndex: async () => 0,
      },
    });

    await handle.tick();
    expect(persisted.length).toBe(1);
    expect(persisted[0].id).toBe("sess-1");
    expect(persisted[0].addr.startsWith("bc1")).toBe(true);

    await client._fire(persisted[0].addr, {
      txid: "t".repeat(64),
      blockHeight: 998,
      confirmations: 3,
      vout: 0,
      valueSats: 10_000n,
    });

    expect(paid.length).toBe(1);
    expect(paid[0].id).toBe("sess-1");
    await handle.stop();
  });

  it("skips re-watching an already-tracked session on subsequent ticks", async () => {
    const session: BridgeSessionRow = {
      sessionId: "sess-2",
      xpub: BITCOIN_TEST_XPUB,
      receiveAddress: null,
      sessionIndex: null,
      expectedSats: 10_000n,
      expiresAt: new Date(Date.now() + 60_000),
    };

    const persist = vi.fn(async () => {});
    const client = makeFakeClient();
    const handle = startBridge({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      pollMs: 3_600_000,
      callbacks: {
        loadSessions: async () => [session],
        persistDerivedAddress: persist,
        onPayment: async () => {},
        onExpire: async () => {},
        nextSessionIndex: async () => 1,
      },
    });

    await handle.tick();
    await handle.tick();
    await handle.tick();

    expect(persist).toHaveBeenCalledTimes(1);
    await handle.stop();
  });

  it("ignores below-confirmation hits", async () => {
    const session: BridgeSessionRow = {
      sessionId: "sess-3",
      xpub: BITCOIN_TEST_XPUB,
      receiveAddress: null,
      sessionIndex: null,
      expectedSats: 10_000n,
      expiresAt: new Date(Date.now() + 60_000),
    };

    const paid = vi.fn(async () => {});
    const client = makeFakeClient();
    const handle = startBridge({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      pollMs: 3_600_000,
      confirmations: 3,
      callbacks: {
        loadSessions: async () => [session],
        persistDerivedAddress: async () => {},
        onPayment: paid,
        onExpire: async () => {},
        nextSessionIndex: async () => 2,
      },
    });

    await handle.tick();
    // Pull the derived address back from the watcher via a re-tick with a
    // stored address on the next pass would require mock complexity —
    // derive it directly instead.
    const { deriveSessionAddress } = await import("../hd");
    const derived = deriveSessionAddress(
      { key: BITCOIN_TEST_XPUB, descriptor: DESCRIPTORS.bitcoin },
      2,
    );

    await client._fire(derived.address, {
      txid: "u".repeat(64),
      blockHeight: 999,
      confirmations: 1, // below threshold
      vout: 0,
      valueSats: 10_000n,
    });

    expect(paid).not.toHaveBeenCalled();
    await handle.stop();
  });

  it("fires onReorg when a confirmed tx disappears from chain", async () => {
    const session: BridgeSessionRow = {
      sessionId: "sess-4",
      xpub: BITCOIN_TEST_XPUB,
      receiveAddress: null,
      sessionIndex: null,
      expectedSats: 10_000n,
      expiresAt: new Date(Date.now() + 60_000),
    };

    const reorged = vi.fn(async () => {});
    const client = makeFakeClient();
    const handle = startBridge({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      pollMs: 3_600_000,
      confirmations: 2,
      reorgCheckMs: 10,
      callbacks: {
        loadSessions: async () => [session],
        persistDerivedAddress: async () => {},
        onPayment: async () => {},
        onExpire: async () => {},
        onReorg: reorged,
        nextSessionIndex: async () => 3,
      },
    });

    await handle.tick();
    const { deriveSessionAddress } = await import("../hd");
    const derived = deriveSessionAddress(
      { key: BITCOIN_TEST_XPUB, descriptor: DESCRIPTORS.bitcoin },
      3,
    );
    const txid = "r".repeat(64);
    // Pretend the tx is initially at height 998; fire the payment.
    client._setTxHeight(txid, 998);
    await client._fire(derived.address, {
      txid,
      blockHeight: 998,
      confirmations: 3,
      vout: 0,
      valueSats: 10_000n,
    });
    // Now simulate reorg: tx no longer on chain.
    client._setTxHeight(txid, null);
    await new Promise((r) => setTimeout(r, 30));
    expect(reorged).toHaveBeenCalledWith("sess-4", txid);
    await handle.stop();
  });
});
