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
  const confirmations = Number(
    process.env.UTXO_CONFIRMATIONS ?? descriptor.defaultConfirmations,
  );
  const pollMs = Number(process.env.UTXO_POLL_MS ?? 15_000);

  const handle = startBridge({
    descriptor,
    client,
    confirmations,
    pollMs,
    callbacks,
  });

  console.log(
    `[utxo-indexer] ${chainKey} watcher up — electrum=${endpoint} confirmations=${confirmations} poll=${pollMs}ms`,
  );

  const shutdown = async (): Promise<void> => {
    console.log("[utxo-indexer] shutdown");
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
