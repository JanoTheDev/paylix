/**
 * UTXO (Bitcoin / Litecoin) payment availability.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS GATE EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * A Bitcoin payment is denominated in satoshis, but `payments.amount` is
 * integer cents. Converting between them needs a fiat rate locked at the
 * moment the buyer is quoted — that is what `checkout_sessions.fiat_rate_cents`
 * / `fiat_rate_captured_at` exist for (see `packages/db/src/schema/checkout-sessions.ts`).
 *
 * The UTXO indexer now does the right thing: it values satoshis against that
 * captured rate and **refuses to write a cents value at all** when no rate is
 * present, retaining the event instead. A retained event is recoverable; a
 * wrong money value silently corrupts revenue totals, per-customer LTV,
 * invoice subtotals and the refund cap.
 *
 * But **nothing writes those columns yet.** So today every Bitcoin payment
 * takes the refusal path: the buyer sends real coin and watches the session
 * expire with nothing recorded. Until rate capture lands, the UTXO checkout
 * path must not be reachable.
 *
 * This flag is the gate. It defaults to OFF and is opt-in via
 * `NEXT_PUBLIC_ENABLE_UTXO_PAYMENTS=true` so the path can still be exercised
 * deliberately in development. Remove the flag — do not merely default it on —
 * once rate capture is writing `fiat_rate_cents` at quote time.
 *
 * Tracking note for the real fix lives in `audit/_requests-web-pages.md`.
 */

/** Every UTXO-family network key in the registry. */
export const UTXO_NETWORK_KEYS = [
  "bitcoin",
  "bitcoin-testnet",
  "litecoin",
  "litecoin-testnet",
] as const;

export type UtxoNetworkKey = (typeof UTXO_NETWORK_KEYS)[number];

export function isUtxoNetwork(
  networkKey: string | null | undefined,
): networkKey is UtxoNetworkKey {
  if (!networkKey) return false;
  return (UTXO_NETWORK_KEYS as readonly string[]).includes(networkKey);
}

/**
 * Direct literal `process.env.NEXT_PUBLIC_*` reference — Next only inlines
 * these into the client bundle when written this way. A dynamic lookup would
 * evaluate to `undefined` at runtime and silently disable the flag.
 */
export const UTXO_PAYMENTS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_UTXO_PAYMENTS === "true";

/** Copy shown to a buyer who lands on a BTC/LTC checkout. */
export const UTXO_BUYER_NOTICE =
  "Bitcoin and Litecoin payments are temporarily unavailable. No payment has been taken and no funds are owed. Please contact the merchant for another way to pay.";

/** Copy shown to a merchant trying to enable a BTC/LTC payout. */
export const UTXO_MERCHANT_NOTICE =
  "Temporarily unavailable. Bitcoin and Litecoin payments can't be recorded correctly yet — a payment would be received on-chain but never settle against your account. This network will be re-enabled once fiat-rate capture ships.";
