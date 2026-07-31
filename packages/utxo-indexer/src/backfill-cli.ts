/**
 * One-shot drain of retained `UtxoPaymentReceivedNoFiatRate` events.
 *
 * The daemon already runs this on a timer; this entry point exists so an
 * operator who has just populated `checkout_sessions.fiat_rate_cents` can
 * settle the backlog immediately instead of waiting for the next tick, and so
 * the recovery path is a runnable command rather than tribal knowledge.
 *
 *   CHAIN_KEY=bitcoin DATABASE_URL=postgres://... npx tsx src/backfill-cli.ts
 *
 * Exits non-zero if any row failed to settle, so it can be used in a job.
 */

import { createDb } from "@paylix/db/client";
import type { UtxoChainKey } from "@paylix/utxo-watcher";
import { runRateBackfill } from "./rate-backfill";

const VALID_KEYS: UtxoChainKey[] = [
  "bitcoin",
  "bitcoin-testnet",
  "litecoin",
  "litecoin-testnet",
];

async function main(): Promise<void> {
  const raw = process.env.CHAIN_KEY;
  if (!raw || !VALID_KEYS.includes(raw as UtxoChainKey)) {
    throw new Error(
      `CHAIN_KEY must be one of: ${VALID_KEYS.join(", ")}. Got: ${raw ?? "(unset)"}`,
    );
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is required");

  const result = await runRateBackfill({
    db: createDb(dbUrl),
    networkKey: raw as UtxoChainKey,
  });

  console.log(
    `[utxo-backfill-cli] examined=${result.examined} settled=${result.settled} ` +
      `pending=${result.pending} orphaned=${result.orphaned} failed=${result.failed}`,
  );
  if (result.failed > 0) process.exit(1);
}

void main().catch((err) => {
  console.error("[utxo-backfill-cli] fatal:", err);
  process.exit(1);
});
