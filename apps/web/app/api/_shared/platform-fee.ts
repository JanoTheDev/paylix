/**
 * Server-authoritative `maxFeeBps` for signed payment / subscription intents.
 *
 * `maxFeeBps` is the highest platform fee the buyer agreed to. The contracts
 * enforce two things at settlement:
 *
 *   require(maxFeeBps <= MAX_PLATFORM_FEE_BPS, "maxFeeBps too high");
 *   require(platformFee <= maxFeeBps,          "Fee above signed max");
 *
 * (`PaymentVault.sol:144,148`; `SubscriptionManager.sol:267-268,456-457`.)
 *
 * A value that is too LOW simply reverts — annoying, not dangerous. A value
 * that is too HIGH is the real risk: it is the buyer signing away a ceiling
 * the platform owner can later raise the fee into, up to 10%. So the client
 * must never be able to choose it. The relay derives the expected value here
 * and requires the client's signed value to match exactly; a mismatch is a
 * 400 telling the client to re-sign, not a silent substitution (substituting
 * would just produce an unverifiable signature anyway, since the buyer signed
 * over their own value).
 *
 * The authoritative source is the chain: `platformFee()` on the contract that
 * will settle the intent. Reading it per relay would add an RPC round trip to
 * the hot path, so it is cached briefly — short enough that a fee change is
 * picked up quickly, long enough to keep the common case free.
 */

import { createPublicClient, http, type Chain } from "viem";

/** Mirrors `MAX_PLATFORM_FEE_BPS` on both contracts (10%). */
export const MAX_PLATFORM_FEE_BPS = 1000n;

const CACHE_TTL_MS = 30_000;

type CacheEntry = { value: bigint; expiresAt: number };
const cache = new Map<string, CacheEntry>();

/** `platformFee()` is an auto-generated getter for a public state var. */
const PLATFORM_FEE_ABI = [
  {
    name: "platformFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export function clearPlatformFeeCache(): void {
  cache.clear();
}

/**
 * Current platform fee in basis points, read from `contractAddress`.
 * Throws if the read fails — refusing to relay is correct here, since
 * guessing the fee would hand the buyer an intent they didn't agree to.
 */
export async function getPlatformFeeBps(args: {
  contractAddress: `0x${string}`;
  chain: Chain;
  chainId: number;
  rpcUrl: string;
}): Promise<bigint> {
  const key = `${args.chainId}:${args.contractAddress.toLowerCase()}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.value;

  const client = createPublicClient({
    chain: args.chain,
    transport: http(args.rpcUrl),
  });
  const value = (await client.readContract({
    address: args.contractAddress,
    abi: PLATFORM_FEE_ABI,
    functionName: "platformFee",
  })) as bigint;

  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

export type MaxFeeBpsCheck =
  | { ok: true; maxFeeBps: bigint }
  | { ok: false; code: string; message: string };

/**
 * Validate the client-signed `maxFeeBps` against the chain's current fee.
 *
 * Exact match is deliberate. Allowing a range would let a client sign a
 * ceiling well above the real fee, which is precisely the value the buyer is
 * supposed to be protected by.
 */
export function checkMaxFeeBps(
  supplied: unknown,
  expected: bigint,
): MaxFeeBpsCheck {
  if (typeof supplied !== "string" && typeof supplied !== "number") {
    return {
      ok: false,
      code: "invalid_body",
      message: "maxFeeBps must be a string or number",
    };
  }
  let value: bigint;
  try {
    value = BigInt(supplied);
  } catch {
    return {
      ok: false,
      code: "invalid_body",
      message: "maxFeeBps must be an integer",
    };
  }
  if (value < 0n || value > MAX_PLATFORM_FEE_BPS) {
    return {
      ok: false,
      code: "invalid_body",
      message: `maxFeeBps must be between 0 and ${MAX_PLATFORM_FEE_BPS}`,
    };
  }
  if (value !== expected) {
    return {
      ok: false,
      code: "max_fee_bps_mismatch",
      message:
        `maxFeeBps must equal the current platform fee (${expected}). ` +
        `Re-sign the intent with maxFeeBps=${expected}.`,
    };
  }
  return { ok: true, maxFeeBps: value };
}
