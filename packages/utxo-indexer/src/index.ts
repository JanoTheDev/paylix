/**
 * UTXO indexer daemon. One process per chain × network pair.
 *
 *   CHAIN_KEY=bitcoin-testnet pnpm --filter @paylix/utxo-indexer start
 *   CHAIN_KEY=litecoin        pnpm --filter @paylix/utxo-indexer start
 *
 * Reads active sessions from Postgres, derives addresses via the merchant's
 * xpub, subscribes to Electrum, credits payments back to the DB on hit.
 */

import { createElectrumClient, getDescriptor, startBridge, type UtxoChainKey } from "@paylix/utxo-watcher";
import { createDb } from "@paylix/db/client";
import { makeUtxoDbCallbacks } from "./db-callbacks";
import { startRateBackfill } from "./rate-backfill";

const VALID_KEYS: UtxoChainKey[] = [
  "bitcoin",
  "bitcoin-testnet",
  "litecoin",
  "litecoin-testnet",
];

/**
 * Parse a numeric env var, rejecting NaN at boot rather than downstream.
 * `Number("six")` is NaN, and `hit.confirmations < NaN` is always false — an
 * unvalidated UTXO_CONFIRMATIONS credits every unconfirmed transaction. See
 * IDX-24.
 */
function positiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const raw = process.env.CHAIN_KEY;
  if (!raw || !VALID_KEYS.includes(raw as UtxoChainKey)) {
    throw new Error(
      `CHAIN_KEY must be one of: ${VALID_KEYS.join(", ")}. Got: ${raw ?? "(unset)"}`,
    );
  }
  const chainKey = raw as UtxoChainKey;
  const descriptor = getDescriptor(chainKey);

  const endpoint =
    process.env[`${chainKey.toUpperCase().replace(/-/g, "_")}_ELECTRUM_URL`] ??
    descriptor.defaultElectrumEndpoint;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is required");
  const db = createDb(dbUrl);

  const client = createElectrumClient({ endpoint, descriptor });
  const callbacks = makeUtxoDbCallbacks({ networkKey: chainKey, db });
  const confirmations = positiveIntEnv("UTXO_CONFIRMATIONS", descriptor.defaultConfirmations);
  const pollMs = positiveIntEnv("UTXO_POLL_MS", 15_000);

  const handle = startBridge({
    descriptor,
    client,
    confirmations,
    pollMs,
    callbacks,
  });

  // Drains payments that were received but could not be priced at the time
  // (no `checkout_sessions.fiat_rate_cents`). Nothing else sweeps that
  // retention — the EVM indexer's unmatched-event retry does not handle these
  // event types. See rate-backfill.ts.
  const backfillMs = positiveIntEnv("UTXO_RATE_BACKFILL_MS", 5 * 60_000);
  const backfill = startRateBackfill({ db, networkKey: chainKey, intervalMs: backfillMs });

  console.log(
    `[utxo-indexer] ${chainKey} watcher up — electrum=${endpoint} confirmations=${confirmations} poll=${pollMs}ms`,
  );
  console.log(`[utxo-indexer] rate backfill drain every ${backfillMs}ms`);

  const shutdown = async (): Promise<void> => {
    console.log("[utxo-indexer] shutdown");
    backfill.stop();
    await handle.stop();
  };
  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((err) => {
    console.error("[utxo-indexer] fatal:", err);
    process.exit(1);
  });
}

export { makeUtxoDbCallbacks } from "./db-callbacks";
export { runRateBackfill, startRateBackfill } from "./rate-backfill";
