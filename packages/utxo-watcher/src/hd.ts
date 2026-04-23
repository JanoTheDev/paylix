/**
 * BIP32 HD-derivation from merchant-provided extended public keys.
 *
 * Paylix never holds the merchant's private keys. The merchant uploads an
 * xpub (or zpub / Ltub / tpub per chain), and this module derives fresh
 * receive addresses per checkout session at a unique BIP44 path. Each
 * address is used exactly once.
 *
 * BIP44 path template used for receive addresses:
 *   m / 0 / <sessionIndex>
 * The merchant-level BIP44 `account` is already baked into the xpub the
 * merchant supplies — typically `m/44'/<coinType>'/0'`, with the final two
 * levels (change=0, index) derived from the xpub on-the-fly here.
 */

import * as bitcoin from "bitcoinjs-lib";
import { BIP32Factory, type BIP32API } from "bip32";
import * as ecc from "tiny-secp256k1";
import type { UtxoChainDescriptor } from "./descriptors";

// bitcoinjs-lib 6.x requires an explicit secp256k1 backend on import.
bitcoin.initEccLib(ecc);
const bip32: BIP32API = BIP32Factory(ecc);

export interface DerivedAddress {
  /** Canonical base58 or bech32 address string (P2WPKH by default). */
  address: string;
  /** Full BIP32 path used to derive it, relative to the xpub's root. */
  derivationPath: string;
  /** Session-scoped index at the terminal node. */
  sessionIndex: number;
}

export interface Xpub {
  /** Extended public key string (xpub / zpub / Ltub / tpub / ...). */
  key: string;
  /** Descriptor whose bip32 version bytes + network magic must match `key`. */
  descriptor: UtxoChainDescriptor;
}

/**
 * Derive the next receive address for a session. Default address type is
 * P2WPKH (native SegWit bech32 — `bc1...` / `ltc1...`) which is cheapest for
 * the buyer to spend from.
 *
 * Call order is intentional: `fromBase58` validates the xpub against the
 * descriptor's BIP32 version bytes. Passing a mainnet xpub against a testnet
 * descriptor (or vice-versa) throws here instead of silently deriving a
 * wrong-network address.
 */
export function deriveSessionAddress(
  xpub: Xpub,
  sessionIndex: number,
): DerivedAddress {
  if (!Number.isInteger(sessionIndex) || sessionIndex < 0) {
    throw new Error(`sessionIndex must be a non-negative integer, got ${sessionIndex}`);
  }

  const network: bitcoin.networks.Network = {
    messagePrefix: xpub.descriptor.network.messagePrefix,
    bech32: xpub.descriptor.network.bech32,
    bip32: xpub.descriptor.network.bip32,
    pubKeyHash: xpub.descriptor.network.pubKeyHash,
    scriptHash: xpub.descriptor.network.scriptHash,
    wif: xpub.descriptor.network.wif,
  };

  const root = bip32.fromBase58(xpub.key, network);
  // Receive chain (BIP44 `change = 0`) + per-session index.
  const child = root.derive(0).derive(sessionIndex);

  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network,
  });
  if (!address) {
    throw new Error("p2wpkh derivation produced no address — corrupt descriptor?");
  }

  return {
    address,
    derivationPath: `m/0/${sessionIndex}`,
    sessionIndex,
  };
}

/**
 * Validate that a string is a syntactically correct extended public key and
 * that its version bytes match the expected descriptor. Returns `true` on
 * success or an error message string on failure — safe to show to merchants.
 */
export function validateXpub(value: string, descriptor: UtxoChainDescriptor): true | string {
  if (typeof value !== "string" || value.length < 100) {
    return "Extended public key looks too short.";
  }

  const network: bitcoin.networks.Network = {
    messagePrefix: descriptor.network.messagePrefix,
    bech32: descriptor.network.bech32,
    bip32: descriptor.network.bip32,
    pubKeyHash: descriptor.network.pubKeyHash,
    scriptHash: descriptor.network.scriptHash,
    wif: descriptor.network.wif,
  };

  try {
    const node = bip32.fromBase58(value, network);
    if (node.privateKey) {
      return "This is an xPRIV (extended PRIVATE key). Paylix must never see your private keys — upload the matching xPUB instead.";
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("network")) {
      return `Extended public key doesn't match ${descriptor.displayName}. Check you copied the right xpub (mainnet vs testnet, Bitcoin vs Litecoin).`;
    }
    return `Invalid extended public key: ${msg}`;
  }
}
