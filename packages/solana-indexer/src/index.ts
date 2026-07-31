/**
 * Solana indexer. Two long-running jobs in one process:
 *   1. Listener — subscribes to `onLogs` for paylix_payment_vault +
 *      paylix_subscription_manager, dispatches Anchor events to the DB.
 *   2. Keeper — polls the shared Postgres for due subscriptions on
 *      network_key='solana' | 'solana-devnet' and submits
 *      charge_subscription transactions via the SubscriptionManager PDA.
 *
 * Runs as a separate process from the EVM indexer; both write to the same
 * schema keyed by network_key.
 */

import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createDb } from "@paylix/db/client";
import { startListener } from "./listener";
import { startKeeper, configPda } from "./keeper";
import { makeSolanaDbCallbacks } from "./db-callbacks";
import { makeSolanaKeeperCallbacks } from "./keeper-callbacks";
import { makeEventHandler } from "./writer";
import { makeSlotCursor } from "./cursor";
import { fetchPlatformWallet } from "./subscription-account";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}

function requireNetworkKey(): "solana" | "solana-devnet" {
  const v = requireEnv("SOLANA_NETWORK_KEY");
  if (v !== "solana" && v !== "solana-devnet") {
    throw new Error(`SOLANA_NETWORK_KEY must be "solana" or "solana-devnet", got "${v}"`);
  }
  return v;
}

/**
 * 'processed' is deliberately not accepted: it exposes rollback-able state,
 * the Solana analogue of the "indexer never reads from the unsafe head"
 * invariant.
 */
function requireCommitment(): "finalized" | "confirmed" {
  const v = process.env.SOLANA_COMMITMENT;
  if (!v) return "finalized";
  if (v !== "finalized" && v !== "confirmed") {
    throw new Error(
      `SOLANA_COMMITMENT must be "finalized" or "confirmed", got "${v}". ` +
        `'processed' is not supported — it can index state that is later rolled back.`,
    );
  }
  return v;
}

/** Parse a numeric env var, rejecting NaN / non-positive rather than trusting it. */
function positiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

function loadKeeperKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main(): Promise<void> {
  const rpcUrl = requireEnv("SOLANA_RPC_URL");
  const networkKey = requireNetworkKey();
  const commitment = requireCommitment();
  const catchUpIntervalMs = positiveIntEnv("SOLANA_CATCHUP_INTERVAL_MS", 60_000);
  const maxCatchUpSignatures = positiveIntEnv("SOLANA_MAX_CATCHUP_SIGNATURES", 10_000);
  const maxColdStartSlots = positiveIntEnv("SOLANA_MAX_COLD_START_SLOTS", 5_000);
  const keeperIntervalMs = positiveIntEnv("SOLANA_KEEPER_INTERVAL_MS", 60_000);
  const connection = new Connection(rpcUrl, commitment);

  const programIds: PublicKey[] = [];
  const vaultId = process.env.SOLANA_PAYMENT_VAULT_PROGRAM_ID;
  if (vaultId) programIds.push(new PublicKey(vaultId));
  const mgrId = process.env.SOLANA_SUBSCRIPTION_MANAGER_PROGRAM_ID;
  if (mgrId) programIds.push(new PublicKey(mgrId));
  if (programIds.length === 0) {
    throw new Error(
      "At least one of SOLANA_PAYMENT_VAULT_PROGRAM_ID / SOLANA_SUBSCRIPTION_MANAGER_PROGRAM_ID must be set.",
    );
  }

  console.log(`[solana-indexer] starting on network_key=${networkKey} rpc=${rpcUrl}`);
  const db = createDb(requireEnv("DATABASE_URL"));
  const dbCallbacks = makeSolanaDbCallbacks({ db, networkKey });
  const onEvent = makeEventHandler(dbCallbacks);

  const listener = await startListener({
    connection,
    programIds,
    commitment,
    // Durable slot cursor: backfills on boot and re-scans on an interval so a
    // restart or a silently-reconnected WebSocket doesn't lose events.
    cursor: makeSlotCursor(db, networkKey),
    catchUpIntervalMs,
    maxCatchUpSignatures,
    maxColdStartSlots,
    onEvent: async (ev) => {
      console.log(`[solana-listener] ${ev.event.kind} at slot ${ev.slot} sig=${ev.signature}`);
      await onEvent(ev);
    },
  });

  const subscriptionManagerProgramId = mgrId ? new PublicKey(mgrId) : undefined;

  let keeperKeypair: Keypair | undefined;
  let keeperCallbacks: ReturnType<typeof makeSolanaKeeperCallbacks> | undefined;
  if (subscriptionManagerProgramId) {
    keeperKeypair = loadKeeperKeypair(requireEnv("SOLANA_KEEPER_KEYPAIR_PATH"));
    const platformWallet = await fetchPlatformWallet(
      connection,
      configPda(subscriptionManagerProgramId),
    );
    if (!platformWallet) {
      throw new Error(
        "SubscriptionManager config account not found on-chain — has `initialize` been called for this program?",
      );
    }
    keeperCallbacks = makeSolanaKeeperCallbacks({ db, connection, networkKey, platformWallet });
  }

  const keeper = await startKeeper({
    connection,
    keeper: keeperKeypair,
    subscriptionManagerProgramId,
    intervalMs: keeperIntervalMs,
    dueSubscriptions: keeperCallbacks?.dueSubscriptions,
    onChargeSubmitted: keeperCallbacks?.onChargeSubmitted,
    onChargeFailed: keeperCallbacks?.onChargeFailed,
  });

  // Both stops drain in-flight work (a catch-up pass, a submitted charge)
  // before resolving, so a container stop doesn't truncate either.
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[solana-indexer] shutdown");
    await keeper.stop();
    await listener.stop();
  };

  const onSignal = (signal: string): void => {
    void shutdown()
      .catch((err) => console.error(`[solana-indexer] ${signal} shutdown failed:`, err))
      .then(() => process.exit(0));
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((err) => {
    console.error("[solana-indexer] fatal:", err);
    process.exit(1);
  });
}
