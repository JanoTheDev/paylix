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

type AlertKey =
  | "relayer_balance_low_fired"
  | "keeper_balance_low_fired"
  | "keeper_failure_rate_high_fired"
  | "webhook_failure_rate_high_fired"
  | "unmatched_retry_queue_deep_fired"
  | "trial_conversion_failure_rate_high_fired";

/** At most one re-fire per this many ms per alert key. */
const ALERT_REFIRE_WINDOW_MS = 60 * 60 * 1000;

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

/**
 * Fires `system.<name>` if a threshold is currently crossed AND the flag
 * hasn't been set within the refire window. Flag timestamp is tracked in
 * the same system_status row via updatedAt.
 */
async function maybeFire(
  key: AlertKey,
  event:
    | "system.keeper_failure_rate_high"
    | "system.webhook_failure_rate_high"
    | "system.unmatched_retry_queue_deep"
    | "system.trial_conversion_failure_rate_high",
  data: Record<string, unknown>,
): Promise<void> {
  const [row] = await db
    .select()
    .from(systemStatus)
    .where(eq(systemStatus.key, key))
    .limit(1);
  const alreadyFiredRecently =
    row?.value === "true" &&
    row?.updatedAt &&
    Date.now() - row.updatedAt.getTime() < ALERT_REFIRE_WINDOW_MS;
  if (alreadyFiredRecently) return;

  await dispatchSystemWebhook(event, data).catch((err) =>
    console.error(`[Alert] ${event} webhook failed:`, err),
  );
  await setFlag(key, true);
  console.log(`[Alert] ${event} fired`, data);
}

async function maybeClear(key: AlertKey): Promise<void> {
  if (await getFlag(key)) await setFlag(key, false);
}

async function checkKeeperFailureRate(): Promise<void> {
  const { payments } = await import("@paylix/db/schema");
  const { and, gte, sql } = await import("drizzle-orm");
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const [{ failed, total }] = await db
    .select({
      failed: sql<number>`cast(count(*) filter (where ${payments.status} = 'failed') as int)`,
      total: sql<number>`cast(count(*) as int)`,
    })
    .from(payments)
    .where(
      and(
        gte(payments.createdAt, since),
        sql`${payments.status} in ('failed', 'confirmed')`,
      ),
    );
  if (total < 5) {
    await maybeClear("keeper_failure_rate_high_fired");
    return;
  }
  const rate = failed / total;
  if (rate > 0.2) {
    await maybeFire(
      "keeper_failure_rate_high_fired",
      "system.keeper_failure_rate_high",
      { failed, total, rate: Math.round(rate * 100) / 100, windowMinutes: 15 },
    );
  } else {
    await maybeClear("keeper_failure_rate_high_fired");
  }
}

async function checkWebhookFailureRate(): Promise<void> {
  const { webhookDeliveries } = await import("@paylix/db/schema");
  const { gte, sql } = await import("drizzle-orm");
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [{ failed, total }] = await db
    .select({
      failed: sql<number>`cast(count(*) filter (where ${webhookDeliveries.status} = 'failed') as int)`,
      total: sql<number>`cast(count(*) as int)`,
    })
    .from(webhookDeliveries)
    .where(gte(webhookDeliveries.createdAt, since));
  if (total < 10) {
    await maybeClear("webhook_failure_rate_high_fired");
    return;
  }
  const rate = failed / total;
  if (rate > 0.3) {
    await maybeFire(
      "webhook_failure_rate_high_fired",
      "system.webhook_failure_rate_high",
      { failed, total, rate: Math.round(rate * 100) / 100, windowMinutes: 60 },
    );
  } else {
    await maybeClear("webhook_failure_rate_high_fired");
  }
}

async function checkUnmatchedRetryQueueDepth(): Promise<void> {
  const { unmatchedEvents } = await import("@paylix/db/schema");
  const { lt, sql } = await import("drizzle-orm");
  // "Deep for 10+ min" = queue depth > 50 AND oldest row is > 10 min old.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(unmatchedEvents)
    .where(lt(unmatchedEvents.createdAt, tenMinAgo));
  if (count > 50) {
    await maybeFire(
      "unmatched_retry_queue_deep_fired",
      "system.unmatched_retry_queue_deep",
      { pending: count, olderThanMinutes: 10 },
    );
  } else {
    await maybeClear("unmatched_retry_queue_deep_fired");
  }
}

async function checkTrialConversionFailureRate(): Promise<void> {
  const { subscriptions } = await import("@paylix/db/schema");
  const { gte, sql } = await import("drizzle-orm");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // Count trial rows that reached a terminal conversion state in the
  // window: active (succeeded) vs trial_conversion_failed (failed).
  const [{ failed, total }] = await db
    .select({
      failed: sql<number>`cast(count(*) filter (where ${subscriptions.status} = 'trial_conversion_failed') as int)`,
      total: sql<number>`cast(count(*) filter (where ${subscriptions.status} in ('active', 'trial_conversion_failed')) as int)`,
    })
    .from(subscriptions)
    .where(gte(subscriptions.updatedAt, since));
  if (total < 3) {
    await maybeClear("trial_conversion_failure_rate_high_fired");
    return;
  }
  const rate = failed / total;
  if (rate > 0.25) {
    await maybeFire(
      "trial_conversion_failure_rate_high_fired",
      "system.trial_conversion_failure_rate_high",
      { failed, total, rate: Math.round(rate * 100) / 100, windowHours: 24 },
    );
  } else {
    await maybeClear("trial_conversion_failure_rate_high_fired");
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
      await checkKeeperFailureRate().catch((err) =>
        console.error("[Alert] keeper failure rate:", err),
      );
      await checkWebhookFailureRate().catch((err) =>
        console.error("[Alert] webhook failure rate:", err),
      );
      await checkUnmatchedRetryQueueDepth().catch((err) =>
        console.error("[Alert] unmatched queue depth:", err),
      );
      await checkTrialConversionFailureRate().catch((err) =>
        console.error("[Alert] trial conversion failure rate:", err),
      );
    } catch (err) {
      console.error("[Alert] Check failed:", err);
    }
  }

  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
  console.log(
    `[Alert] Monitors scheduled every ${CHECK_INTERVAL_MS / 1000}s`,
  );
}
