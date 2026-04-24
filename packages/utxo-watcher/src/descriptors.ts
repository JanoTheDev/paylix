/**
 * UTXO chain descriptors. Each descriptor captures the small set of values
 * that differ between Bitcoin-derived chains: BIP44 coin type, address prefix
 * magic, default Electrum backend, confirmation threshold, explorer URL.
 *
 * Adding a new UTXO chain is a single descriptor entry plus optionally
 * overriding the network type passed to bitcoinjs-lib.
 */

export type UtxoChainKey =
  | "bitcoin"
  | "bitcoin-testnet"
  | "litecoin"
  | "litecoin-testnet";

export interface UtxoNetworkMagic {
  /** bitcoinjs-lib Network.messagePrefix */
  messagePrefix: string;
  /** bech32 HRP (bc, tb, ltc, tltc). */
  bech32: string;
  /** BIP32 extended-key version bytes for pub/priv xkeys. */
  bip32: { public: number; private: number };
  /** Base58Check version byte for P2PKH addresses (starts with 1 / m / n / L). */
  pubKeyHash: number;
  /** Base58Check version byte for P2SH addresses (starts with 3 / 2 / M). */
  scriptHash: number;
  /** WIF version byte for private keys. */
  wif: number;
}

export interface UtxoChainDescriptor {
  key: UtxoChainKey;
  displayName: string;
  environment: "mainnet" | "testnet";
  /** BIP44 coin type (0'=BTC, 1'=any-testnet, 2'=LTC). */
  bip44CoinType: number;
  /** Satoshis per whole coin — 1e8 for both BTC and LTC. */
  satoshisPerCoin: bigint;
  /** Minimum confirmations before a payment is considered final. */
  defaultConfirmations: number;
  /** Explorer URL template — `{txid}` is replaced with the transaction hash. */
  explorerTxUrl: string;
  /** Fallback Electrum WebSocket/TCP endpoint when no operator override is set. */
  defaultElectrumEndpoint: string;
  /** bitcoinjs-lib compatible magic. */
  network: UtxoNetworkMagic;
}

// ── Bitcoin ───────────────────────────────────────────────────────
const BITCOIN_MAINNET_NETWORK: UtxoNetworkMagic = {
  messagePrefix: "\x18Bitcoin Signed Message:\n",
  bech32: "bc",
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  wif: 0x80,
};

const BITCOIN_TESTNET_NETWORK: UtxoNetworkMagic = {
  messagePrefix: "\x18Bitcoin Signed Message:\n",
  bech32: "tb",
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

// ── Litecoin ──────────────────────────────────────────────────────
// Ltub/Ltpv BIP32 version bytes. Using Bitcoin's (0x0488b21e/0x0488ade4)
// here would silently accept a Bitcoin xpub as a Litecoin xpub and derive
// LTC addresses from BTC keys — see issue #73.
const LITECOIN_MAINNET_NETWORK: UtxoNetworkMagic = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

const LITECOIN_TESTNET_NETWORK: UtxoNetworkMagic = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "tltc",
  bip32: { public: 0x0436f6e1, private: 0x0436ef7d },
  pubKeyHash: 0x6f,
  scriptHash: 0x3a,
  wif: 0xef,
};

export const DESCRIPTORS: Record<UtxoChainKey, UtxoChainDescriptor> = {
  bitcoin: {
    key: "bitcoin",
    displayName: "Bitcoin",
    environment: "mainnet",
    bip44CoinType: 0,
    satoshisPerCoin: 100_000_000n,
    // 6 confs (~1 hour) is the standard merchant threshold. Operators can
    // lower via UTXO_CONFIRMATIONS but the default must be safe — see #77.
    defaultConfirmations: 6,
    explorerTxUrl: "https://mempool.space/tx/{txid}",
    defaultElectrumEndpoint: "wss://electrum.blockstream.info:50002",
    network: BITCOIN_MAINNET_NETWORK,
  },
  "bitcoin-testnet": {
    key: "bitcoin-testnet",
    displayName: "Bitcoin Testnet",
    environment: "testnet",
    bip44CoinType: 1,
    satoshisPerCoin: 100_000_000n,
    defaultConfirmations: 1,
    explorerTxUrl: "https://mempool.space/testnet/tx/{txid}",
    defaultElectrumEndpoint: "wss://electrum.blockstream.info:60002",
    network: BITCOIN_TESTNET_NETWORK,
  },
  litecoin: {
    key: "litecoin",
    displayName: "Litecoin",
    environment: "mainnet",
    bip44CoinType: 2,
    satoshisPerCoin: 100_000_000n,
    // Faster blocks (~2.5 min), but keep 6 for roughly BTC-equivalent safety.
    defaultConfirmations: 6,
    explorerTxUrl: "https://live.blockcypher.com/ltc/tx/{txid}",
    defaultElectrumEndpoint: "wss://electrum-ltc.bysh.me:50004",
    network: LITECOIN_MAINNET_NETWORK,
  },
  "litecoin-testnet": {
    key: "litecoin-testnet",
    displayName: "Litecoin Testnet",
    environment: "testnet",
    bip44CoinType: 1,
    satoshisPerCoin: 100_000_000n,
    defaultConfirmations: 2,
    explorerTxUrl: "https://chain.so/tx/LTCTEST/{txid}",
    defaultElectrumEndpoint: "wss://electrum-ltc-testnet.example.com:50004",
    network: LITECOIN_TESTNET_NETWORK,
  },
};

export function getDescriptor(key: UtxoChainKey): UtxoChainDescriptor {
  const d = DESCRIPTORS[key];
  if (!d) throw new Error(`Unknown UTXO chain key: ${key}`);
  return d;
}
