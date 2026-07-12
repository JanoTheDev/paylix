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
import { startKeeper } from "./keeper";
import { makeSolanaDbCallbacks } from "./db-callbacks";
import { makeSolanaKeeperCallbacks } from "./keeper-callbacks";
import { makeEventHandler } from "./writer";

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

function loadKeeperKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main(): Promise<void> {
  const rpcUrl = requireEnv("SOLANA_RPC_URL");
  const networkKey = requireNetworkKey();
  const commitment =
    (process.env.SOLANA_COMMITMENT as "finalized" | "confirmed" | undefined) ??
    "finalized";
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
    onEvent: async (ev) => {
      console.log(`[solana-listener] ${ev.event.kind} at slot ${ev.slot} sig=${ev.signature}`);
      await onEvent(ev);
    },
  });

  const keeperKeypair = loadKeeperKeypair(requireEnv("SOLANA_KEEPER_KEYPAIR_PATH"));
  const platformWallet = new PublicKey(requireEnv("SOLANA_PLATFORM_WALLET"));
  const subscriptionManagerProgramId = mgrId ? new PublicKey(mgrId) : undefined;
  const keeperCallbacks = subscriptionManagerProgramId
    ? makeSolanaKeeperCallbacks({ db, connection, networkKey, platformWallet })
    : undefined;

  const keeper = await startKeeper({
    connection,
    keeper: keeperKeypair,
    subscriptionManagerProgramId,
    dueSubscriptions: keeperCallbacks?.dueSubscriptions,
    onChargeSubmitted: keeperCallbacks?.onChargeSubmitted,
    onChargeFailed: keeperCallbacks?.onChargeFailed,
  });

  const shutdown = async (): Promise<void> => {
    console.log("[solana-indexer] shutdown");
    await listener.stop();
    await keeper.stop();
  };

  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((err) => {
    console.error("[solana-indexer] fatal:", err);
    process.exit(1);
  });
}
