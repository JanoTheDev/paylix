/**
 * Human-readable decimal string ↔ native token unit (bigint) conversion.
 *
 * Why bigint: ETH and other 18-decimal tokens overflow JavaScript's safe
 * integer range. "1 ETH" in native units is 1e18, well above Number.MAX_SAFE_INTEGER.
 *
 * This module replaces the ad-hoc `cents * 10_000` math in checkout-client.tsx.
 * Every place that reads/writes amounts should go through these helpers so
 * the decimals assumption is in one file.
 */

/**
 * Converts a human-readable decimal string (e.g. "10.00", "0.003") to the
 * native unit representation used on-chain. Throws on invalid or
 * over-precision input.
 */
export function toNativeUnits(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Amount cannot be empty");
  }
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
    if (trimmed.startsWith("-")) {
      throw new Error("Amount must be positive");
    }
    throw new Error(`Amount '${input}' is not a valid decimal number`);
  }

  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(
      `Amount '${input}' has ${fraction.length} decimals but the token ` +
        `only supports ${decimals}`,
    );
  }

  const padded = fraction.padEnd(decimals, "0");
  const combined = whole + padded;
  const cleaned = combined.replace(/^0+(?=\d)/, "");
  return BigInt(cleaned || "0");
}

/**
 * Converts a native-unit bigint back to a human-readable decimal string
 * with trailing zeros stripped. "10_000_000" (USDC) → "10".
 */
export function fromNativeUnits(amount: bigint, decimals: number): string {
  if (amount === 0n) return "0";
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const fraction = s.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Token base units that represent one cent, for a token with `decimals`.
 *
 * `10_000` (the value hardcoded across tax, analytics and refund
 * verification) is only correct for 6-decimal tokens like USDC. An
 * 18-decimal token is off by 10^12, which silently inflates every derived
 * cent figure. Always derive the scale from the token registry:
 *
 *   baseUnitsPerCent(getToken(networkKey, tokenSymbol).decimals)
 *
 * Throws for tokens with fewer than 2 decimals, where a cent is not
 * representable at all.
 */
export function baseUnitsPerCent(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`Invalid token decimals: ${decimals}`);
  }
  if (decimals < 2) {
    throw new Error(
      `Token with ${decimals} decimals cannot represent a cent; refuse to convert`,
    );
  }
  return 10n ** BigInt(decimals - 2);
}

/** Convert a native-unit amount to integer cents, truncating any remainder. */
export function nativeUnitsToCents(amount: bigint, decimals: number): number {
  const cents = amount / baseUnitsPerCent(decimals);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount exceeds the safe integer range in cents");
  }
  return Number(cents);
}

/** Pretty-print an amount with its symbol (used in UI labels). */
export function formatNativeAmount(
  amount: bigint,
  decimals: number,
  symbol: string,
): string {
  return `${fromNativeUnits(amount, decimals)} ${symbol}`;
}
