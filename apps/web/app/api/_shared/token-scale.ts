/**
 * Cents ↔ native-token-unit scaling, resolved through the token registry.
 *
 * `10_000` (USDC's 6 decimals minus 2 for cents) was hardcoded in the tax
 * recompute, the analytics MRR rollup and both refund verifiers. With
 * multi-token support, `checkout_sessions.amount` and `product_prices.amount`
 * are per-token native units, so that constant was off by 10^12 for an
 * 18-decimal token (WETH/DAI).
 *
 * The scalar math lives in `lib/amounts.ts`; this module only adds the
 * registry lookup. `baseUnitsPerCent`/`nativeUnitsToCents` **throw** for
 * tokens that cannot represent a cent — a silently 100×-wrong scale in refund
 * verification is worse than a 4xx — so the `*For` wrappers return `null` and
 * let the route decide.
 */

import { getToken, type NetworkKey } from "@paylix/config/networks";

export { baseUnitsPerCent, nativeUnitsToCents } from "@/lib/amounts";

import { baseUnitsPerCent as scalarBaseUnitsPerCent } from "@/lib/amounts";

/** Registered decimals for a (network, token) pair, or `null` if unknown. */
export function tokenDecimalsFor(
  networkKey: string | null | undefined,
  tokenSymbol: string | null | undefined,
): number | null {
  if (!networkKey || !tokenSymbol) return null;
  try {
    return getToken(networkKey as NetworkKey, tokenSymbol).decimals;
  } catch {
    return null;
  }
}

/**
 * Base units representing one cent for a (network, token) pair.
 * `null` when the pair isn't registered, or when the token has too few
 * decimals to represent a cent at all.
 */
export function baseUnitsPerCentFor(
  networkKey: string | null | undefined,
  tokenSymbol: string | null | undefined,
): bigint | null {
  const decimals = tokenDecimalsFor(networkKey, tokenSymbol);
  if (decimals === null) return null;
  try {
    return scalarBaseUnitsPerCent(decimals);
  } catch {
    return null;
  }
}

/**
 * Native units → whole cents, saturating at `Number.MAX_SAFE_INTEGER` rather
 * than throwing. Used where an out-of-range amount should degrade (a tax
 * lookup, a chart series) instead of failing the request.
 */
export function nativeUnitsToCentsSaturating(
  amount: bigint,
  unitsPerCent: bigint,
): number {
  if (unitsPerCent <= 0n) return 0;
  const cents = amount / unitsPerCent;
  if (cents <= 0n) return 0;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(cents > max ? max : cents);
}
