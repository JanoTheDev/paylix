/**
 * Static Solana mint -> token map. Deliberately NOT part of @paylix/config —
 * that package's NetworkKey type is EVM-only by design (see
 * packages/config/src/__tests__/networks.test.ts, which asserts "solana" is
 * an invalid key). Three tokens, two clusters; a full registry would be
 * over-engineering for this surface.
 *
 * Devnet mint addresses are placeholders from the paylix devnet token
 * deployment tracked alongside the Anchor program deploy scripts — update
 * this map if those addresses change.
 */

export interface SolanaTokenInfo {
  symbol: string;
  decimals: number;
}

const MAINNET_MINTS: Record<string, SolanaTokenInfo> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": { symbol: "PYUSD", decimals: 6 },
};

const DEVNET_MINTS: Record<string, SolanaTokenInfo> = {
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": { symbol: "USDC", decimals: 6 },
};

export function resolveMint(
  networkKey: "solana" | "solana-devnet",
  mint: string,
): SolanaTokenInfo {
  const table = networkKey === "solana" ? MAINNET_MINTS : DEVNET_MINTS;
  const info = table[mint];
  if (!info) {
    throw new Error(`resolveMint: unrecognized mint ${mint} on ${networkKey}`);
  }
  return info;
}
