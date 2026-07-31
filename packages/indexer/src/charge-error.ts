/**
 * Classifies why a `chargeSubscription` call failed.
 *
 * Since the payability pre-check landed, `chargeSubscription` only reaches the
 * transfer when allowance and balance already cover the charge — so the
 * residual revert surface is token level. A USDC-blacklisted subscriber or a
 * paused token passes `_permit2CanPay`/`_selectPayer` and then reverts inside
 * `transferFrom`, which reverts the whole call: the contract's own
 * `Status.PastDue` write never lands, so the subscription stays Active on-chain
 * and the keeper is the only thing that can escalate it.
 *
 * Those failures are deterministic — the same charge reverts every cycle — so
 * they must go straight to dunning rather than walking the retry ladder while
 * each attempt burns gas and a receipt wait in the keeper's sequential loop.
 */
export type ChargeFailureKind =
  /** Token contract refused the transfer (blacklist, freeze, token paused). */
  | "token_blocked"
  /** Our own infrastructure or the manager being paused — not the subscriber's fault. */
  | "transient"
  | "unknown";

// USDC (FiatTokenV2) reverts with "Blacklistable: account is blacklisted" and
// "Pausable: paused"; other tokens use frozen/blocked wording. Permit2 bubbles
// the token's revert reason.
const TOKEN_BLOCKED_PATTERNS = [
  /blacklist/i,
  /is not allowed to (send|receive)/i,
  /account is frozen/i,
  /\bfrozen\b/i,
  /\bblocked\b/i,
  /Pausable: paused/i,
  /ERC20Pausable/i,
  /token transfer while paused/i,
];

// OZ v5 pauses with the custom error EnforcedPause() — that is OUR contract
// being paused by the operator, not the token.
const TRANSIENT_PATTERNS = [
  /EnforcedPause/i,
  /Gasless paused/i,
  /Not due yet/i,
  /timed? ?out/i,
  /timeout/i,
  /429|rate limit|too many requests|throttle/i,
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|fetch failed/i,
  /nonce too low|replacement transaction underpriced|already known/i,
  /insufficient funds for (gas|intrinsic)/i,
];

export function classifyChargeFailure(err: unknown): ChargeFailureKind {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (!message) return "unknown";

  // Transient wins: "EnforcedPause" must not be read as a token pause, and a
  // relayer-side gas problem is never the subscriber's fault.
  if (TRANSIENT_PATTERNS.some((re) => re.test(message))) return "transient";
  if (TOKEN_BLOCKED_PATTERNS.some((re) => re.test(message))) return "token_blocked";
  return "unknown";
}
