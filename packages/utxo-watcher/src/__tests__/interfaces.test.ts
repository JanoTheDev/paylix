import { describe, it, expect } from "vitest";
import { deriveSessionAddress, validateXpub } from "../hd";
import { createElectrumClient } from "../electrum";
import { startWatcher } from "../watcher";
import { DESCRIPTORS } from "../descriptors";

// Public Bitcoin xpub from the BIP32 test vectors — safe to hardcode.
const BITCOIN_TEST_XPUB =
  "xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj";

describe("validateXpub", () => {
  it("accepts a well-formed mainnet Bitcoin xpub", () => {
    expect(validateXpub(BITCOIN_TEST_XPUB, DESCRIPTORS.bitcoin)).toBe(true);
  });

  it("rejects a mainnet xpub against a testnet descriptor", () => {
    const result = validateXpub(BITCOIN_TEST_XPUB, DESCRIPTORS["bitcoin-testnet"]);
    expect(result).not.toBe(true);
    expect(typeof result).toBe("string");
  });

  it("rejects obviously malformed input", () => {
    expect(validateXpub("not-an-xpub", DESCRIPTORS.bitcoin)).not.toBe(true);
    expect(validateXpub("", DESCRIPTORS.bitcoin)).not.toBe(true);
  });
});

describe("deriveSessionAddress", () => {
  it("derives a bech32 p2wpkh address for Bitcoin mainnet", () => {
    const result = deriveSessionAddress(
      { key: BITCOIN_TEST_XPUB, descriptor: DESCRIPTORS.bitcoin },
      0,
    );
    expect(result.address.startsWith("bc1")).toBe(true);
    expect(result.derivationPath).toBe("m/0/0");
    expect(result.sessionIndex).toBe(0);
  });

  it("produces distinct addresses for distinct session indices", () => {
    const a = deriveSessionAddress(
      { key: BITCOIN_TEST_XPUB, descriptor: DESCRIPTORS.bitcoin },
      0,
    );
    const b = deriveSessionAddress(
      { key: BITCOIN_TEST_XPUB, descriptor: DESCRIPTORS.bitcoin },
      1,
    );
    expect(a.address).not.toBe(b.address);
  });

  it("is deterministic for the same index", () => {
    const a = deriveSessionAddress(
      { key: BITCOIN_TEST_XPUB, descriptor: DESCRIPTORS.bitcoin },
      42,
    );
    const b = deriveSessionAddress(
      { key: BITCOIN_TEST_XPUB, descriptor: DESCRIPTORS.bitcoin },
      42,
    );
    expect(a.address).toBe(b.address);
  });

  it("rejects negative or non-integer session indices", () => {
    expect(() =>
      deriveSessionAddress(
        { key: BITCOIN_TEST_XPUB, descriptor: DESCRIPTORS.bitcoin },
        -1,
      ),
    ).toThrow();
    expect(() =>
      deriveSessionAddress(
        { key: BITCOIN_TEST_XPUB, descriptor: DESCRIPTORS.bitcoin },
        1.5,
      ),
    ).toThrow();
  });
});

describe("electrum client factory", () => {
  it("returns a client with the expected shape", () => {
    const client = createElectrumClient({
      endpoint: "wss://electrum.example.test:50002",
      descriptor: DESCRIPTORS.bitcoin,
    });
    expect(typeof client.subscribeAddress).toBe("function");
    expect(typeof client.getTipHeight).toBe("function");
    expect(typeof client.close).toBe("function");
  });
});

describe("watcher factory", () => {
  it("returns a handle with watch/unwatch/stop methods", async () => {
    const client = createElectrumClient({
      endpoint: "wss://electrum.example.test:50002",
      descriptor: DESCRIPTORS.bitcoin,
    });
    const handle = startWatcher({
      descriptor: DESCRIPTORS.bitcoin,
      client,
      confirmations: 2,
      callbacks: {
        async onPayment() {},
        async onExpire() {},
      },
    });
    expect(typeof handle.watch).toBe("function");
    expect(typeof handle.unwatch).toBe("function");
    expect(typeof handle.stop).toBe("function");
    await handle.stop();
  });
});
