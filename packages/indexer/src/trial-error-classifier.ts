export type TrialConversionError =
  | "insufficient_balance"
  | "allowance_revoked"
  | "permit_expired"
  | "nonce_drift"
  /**
   * The stored SubscriptionIntent signature predates the current typehash (it
   * has no `maxFeeBps`/`flow`, or names a retired SubscriptionManager). It can
   * never verify and re-signing needs the buyer, so the subscription must be
   * re-authorised from checkout. Detected before submission, never from a
   * revert — see checkIntentCompatibility in trial-converter.ts.
   */
  | "intent_schema_outdated"
  | "unknown";

export function classifyTrialConversionError(err: unknown): TrialConversionError {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const lower = message.toLowerCase();

  if (lower.includes("transfer amount exceeds balance")) return "insufficient_balance";
  if (lower.includes("insufficient allowance")) return "allowance_revoked";
  if (lower.includes("expired deadline") || lower.includes("permit expired")) return "permit_expired";
  if (
    lower.includes("intentalreadyused") ||
    lower.includes("intent already used") ||
    lower.includes("nonce")
  ) {
    return "nonce_drift";
  }
  return "unknown";
}

export function isTerminal(category: TrialConversionError): boolean {
  return (
    category === "permit_expired" ||
    category === "nonce_drift" ||
    category === "allowance_revoked" ||
    category === "intent_schema_outdated"
  );
}
