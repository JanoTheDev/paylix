/**
 * On-chain amount -> integer cents.
 *
 * Prices are integer cents everywhere in the system (`1000` = $10.00) and the
 * columns that store them are `integer`, so every conversion MUST round.
 * Without the rounding, any on-chain amount that is not an exact multiple of
 * 10^(decimals-2) — coupon-adjusted totals, dust, tokens with unusual
 * decimals — produces a float that Postgres rejects, which aborts the
 * enclosing transaction and loses the payment.
 *
 * Formula: cents = on_chain / 10^(decimals - 2)
 * For USDC (decimals=6): 10^4 = 10,000 -> 1,000,000 units = 100 cents.
 */
export function toCents(
  onChainAmount: bigint | number | string,
  decimals: number,
): number {
  const divisor = 10 ** (decimals - 2);
  return Math.round(Number(onChainAmount) / divisor);
}
