import { createDb } from "@paylix/db/client";
import { systemStatus } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config, deployments } from "./config";
import { dispatchSystemWebhook } from "./webhook-dispatch";

/**
 * Balance thresholds below which an alert fires. One shared value for both
 * relayer and keeper since they play similar roles.
 */
const LOW_BALANCE_WEI = BigInt("1000000000000000"); // 0.001 ETH

/**
 * How often to poll and alert. Alerts are debounced via a system_status row
 * so we only fire once per threshold crossing.
 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

type AlertKey = "relayer_balance_low_fired" | "keeper_balance_low_fired";

function getRelayerAddress(): `0x${string}` | null {
  if (!config.relayerPrivateKey) return null;
  const key = config.relayerPrivateKey.startsWith("0x")
    ? config.relayerPrivateKey
    : `0x${config.relayerPrivateKey}`;
  try {
    return privateKeyToAccount(key as `0x${string}`).address;
  } catch {
    return null;
  }
}

function getKeeperAddress(): `0x${string}` | null {
  if (!config.keeperPrivateKey) return null;
  const key = config.keeperPrivateKey.startsWith("0x")
    ? config.keeperPrivateKey
    : `0x${config.keeperPrivateKey}`;
  try {
    return privateKeyToAccount(key as `0x${string}`).address;
  } catch {
    return null;
  }
}

const db = createDb(config.databaseUrl);

async function getFlag(key: AlertKey): Promise<boolean> {
  const [row] = await db
    .select()
    .from(systemStatus)
    .where(eq(systemStatus.key, key))
    .limit(1);
  return row?.value === "true";
}

async function setFlag(key: AlertKey, value: boolean): Promise<void> {
  await db
    .insert(systemStatus)
    .values({ key, value: value ? "true" : "false" })
    .onConflictDoUpdate({
      target: systemStatus.key,
      set: { value: value ? "true" : "false", updatedAt: new Date() },
    });
}

async function checkBalance(
  label: "relayer" | "keeper",
  address: `0x${string}`,
  alertKey: AlertKey,
  eventName: "system.relayer_balance_low" | "system.keeper_balance_low",
) {
  let anyLow = false;

  for (const d of deployments) {
    const client = createPublicClient({
      chain: d.chain,
      transport: http(d.rpcUrl),
    });

    const balance = await client.getBalance({ address });
    const isLow = balance < LOW_BALANCE_WEI;

    if (isLow) {
      anyLow = true;
      console.warn(
        `[Alert] ${label} balance low on ${d.networkKey}: ${formatEther(balance)} ETH at ${address}`,
      );
      const wasFiredAlready = await getFlag(alertKey);
      if (!wasFiredAlready) {
        await dispatchSystemWebhook(eventName, {
          address,
          balanceWei: balance.toString(),
          balanceEth: formatEther(balance),
          thresholdWei: LOW_BALANCE_WEI.toString(),
          networkKey: d.networkKey,
          livemode: d.livemode,
        });
        await setFlag(alertKey, true);
      }
    }
  }

  if (!anyLow) {
    const wasFiredAlready = await getFlag(alertKey);
    if (wasFiredAlready) {
      console.log(`[Alert] ${label} balance recovered across all deployments`);
      await setFlag(alertKey, false);
    }
  }
}

export function startAlertsLoop() {
  const relayerAddress = getRelayerAddress();
  const keeperAddress = getKeeperAddress();

  async function tick() {
    try {
      if (relayerAddress) {
        await checkBalance(
          "relayer",
          relayerAddress,
          "relayer_balance_low_fired",
          "system.relayer_balance_low",
        );
      }
      if (keeperAddress) {
        await checkBalance(
          "keeper",
          keeperAddress,
          "keeper_balance_low_fired",
          "system.keeper_balance_low",
        );
      }
    } catch (err) {
      console.error("[Alert] Check failed:", err);
    }
  }

  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
  console.log(
    `[Alert] Balance monitor scheduled every ${CHECK_INTERVAL_MS / 1000}s`,
  );
}
