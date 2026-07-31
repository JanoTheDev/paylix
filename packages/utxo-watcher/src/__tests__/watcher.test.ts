import { describe, it, expect, vi } from "vitest";
import type { AddressPaymentHit, ElectrumClient } from "../electrum";
import { startWatcher, type WatcherSession } from "../watcher";
import { DESCRIPTORS } from "../descriptors";

function makeFakeClient(overrides: Partial<ElectrumClient> = {}) {
  const subs = new Map<string, (hit: AddressPaymentHit) => void | Promise<void>>();
  const unsubscribed: string[] = [];
  const client: ElectrumClient & {
    _fire: (address: string, hit: AddressPaymentHit) => Promise<void>;
    _unsubscribed: string[];
    _isSubscribed: (address: string) => boolean;
  } = {
    async subscribeAddress(address, onHit) {
      subs.set(address, onHit);
      return () => {
        subs.delete(address);
        unsubscribed.push(address);
      };
    },
    async getTipHeight() {
      return 1000;
    },
    async getTransactionBlockHash() {
      return "blk900";
    },
    async close() {},
    async _fire(address, hit) {
      const cb = subs.get(address);
      if (cb) await cb(hit);
    },
    _unsubscribed: unsubscribed,
    _isSubscribed: (address: string) => subs.has(address),
    ...overrides,
  };
  return client;
}

const SESSION: WatcherSession = {
  sessionId: "sess-1",
  address: "bc1qexampleaddress",
  expectedSats: 10_000n,
  expiresAt: new Date(Date.now() + 600_000),
};

function hit(overrides: Partial<AddressPaymentHit> = {}): AddressPaymentHit {
  return {
    txid: "tx-1",
    blockHeight: 900,
    confirmations: 6,
    vout: 0,
    valueSats: 10_000n,
    blockHash: "blk900",
    ...overrides,
  };
}

describe("watcher payment handling", () => {
  it("reports the payment and stops watching the address on success", async () => {
    const client = makeFakeClient();
    const onPayment = vi.fn(async () => {});
    const watcher = startWatcher({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      confirmations: 2,
      callbacks: { onPayment, onExpire: async () => {} },
    });

    await watcher.watch(SESSION);
    await client._fire(SESSION.address, hit());

    expect(onPayment).toHaveBeenCalledTimes(1);
    expect(client._isSubscribed(SESSION.address)).toBe(false);
    await watcher.stop();
  });

  it("keeps the address watched and retries when onPayment fails", async () => {
    const client = makeFakeClient();
    const onPayment = vi
      .fn<(s: WatcherSession, h: AddressPaymentHit) => Promise<void>>()
      .mockRejectedValueOnce(new Error("DB down"))
      .mockResolvedValueOnce(undefined);

    const watcher = startWatcher({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      confirmations: 2,
      callbacks: { onPayment, onExpire: async () => {} },
    });

    await watcher.watch(SESSION);
    // A failed write must not mark the txid as fired or tear down the watch.
    await expect(client._fire(SESSION.address, hit())).resolves.toBeUndefined();
    expect(client._isSubscribed(SESSION.address)).toBe(true);

    // Next notification for the same txid retries and succeeds.
    await client._fire(SESSION.address, hit());
    expect(onPayment).toHaveBeenCalledTimes(2);
    expect(client._isSubscribed(SESSION.address)).toBe(false);
    await watcher.stop();
  });

  it("does not double-report a txid once it succeeded", async () => {
    const client = makeFakeClient();
    const onPayment = vi.fn(async () => {});
    const watcher = startWatcher({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      confirmations: 2,
      callbacks: { onPayment, onExpire: async () => {} },
    });

    await watcher.watch(SESSION);
    await client._fire(SESSION.address, hit());
    await client._fire(SESSION.address, hit());

    expect(onPayment).toHaveBeenCalledTimes(1);
    await watcher.stop();
  });

  it("surfaces an underpayment instead of discarding it silently", async () => {
    const client = makeFakeClient();
    const onPayment = vi.fn(async () => {});
    const onUnderpayment = vi.fn(async () => {});
    const watcher = startWatcher({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      confirmations: 2,
      callbacks: { onPayment, onExpire: async () => {}, onUnderpayment },
    });

    await watcher.watch(SESSION);
    await client._fire(SESSION.address, hit({ valueSats: 9_999n }));
    // Repeat notifications for the same tx report once, not on every push.
    await client._fire(SESSION.address, hit({ valueSats: 9_999n }));

    expect(onPayment).not.toHaveBeenCalled();
    expect(onUnderpayment).toHaveBeenCalledTimes(1);
    expect(onUnderpayment).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-1" }),
      expect.objectContaining({ txid: "tx-1" }),
      1n,
    );
    await watcher.stop();
  });
});

describe("watcher reorg monitoring", () => {
  it("does not fire onReorg when the height lookup is transient (undefined)", async () => {
    const onReorg = vi.fn(async () => {});
    const client = makeFakeClient({
      // Transient Electrum failure — must never be read as a reorg (IDX-09).
      getTransactionBlockHash: async () => undefined,
    });
    const watcher = startWatcher({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      confirmations: 2,
      reorgCheckMs: 3_600_000,
      callbacks: { onPayment: async () => {}, onExpire: async () => {}, onReorg },
    });

    await watcher.watch(SESSION);
    await client._fire(SESSION.address, hit());
    await (watcher as unknown as { checkReorgs(): Promise<void> }).checkReorgs();

    expect(onReorg).not.toHaveBeenCalled();
    await watcher.stop();
  });

  it("fires onReorg when the server says the tx is in no block", async () => {
    const onReorg = vi.fn(async () => {});
    const client = makeFakeClient({ getTransactionBlockHash: async () => null });
    const watcher = startWatcher({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      confirmations: 2,
      reorgCheckMs: 3_600_000,
      callbacks: { onPayment: async () => {}, onExpire: async () => {}, onReorg },
    });

    await watcher.watch(SESSION);
    await client._fire(SESSION.address, hit());
    await (watcher as unknown as { checkReorgs(): Promise<void> }).checkReorgs();

    expect(onReorg).toHaveBeenCalledWith("sess-1", "tx-1");
    await watcher.stop();
  });

  it("does not fire onReorg when the tip advances but the block is unchanged", async () => {
    const onReorg = vi.fn(async () => {});
    let tip = 900;
    const client = makeFakeClient({
      // Same block, tip moving during the check — the old `tip - conf + 1`
      // derivation shifted by one here and destroyed the payment (IDX-09).
      getTipHeight: async () => ++tip,
      getTransactionBlockHash: async () => "blk900",
    });
    const watcher = startWatcher({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      confirmations: 2,
      reorgCheckMs: 3_600_000,
      callbacks: { onPayment: async () => {}, onExpire: async () => {}, onReorg },
    });

    await watcher.watch(SESSION);
    await client._fire(SESSION.address, hit());
    const check = (watcher as unknown as { checkReorgs(): Promise<void> }).checkReorgs.bind(watcher);
    await check();
    await check();
    await check();

    expect(onReorg).not.toHaveBeenCalled();
    await watcher.stop();
  });

  it("retries the reorg callback on the next cycle when it fails", async () => {
    const onReorg = vi
      .fn<(sessionId: string, txid: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("DB down"))
      .mockResolvedValueOnce(undefined);
    const client = makeFakeClient({ getTransactionBlockHash: async () => null });
    const watcher = startWatcher({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      confirmations: 2,
      reorgCheckMs: 3_600_000,
      callbacks: { onPayment: async () => {}, onExpire: async () => {}, onReorg },
    });

    await watcher.watch(SESSION);
    await client._fire(SESSION.address, hit());
    const check = (watcher as unknown as { checkReorgs(): Promise<void> }).checkReorgs.bind(watcher);
    await check();
    await check();

    expect(onReorg).toHaveBeenCalledTimes(2);
    await watcher.stop();
  });
});
