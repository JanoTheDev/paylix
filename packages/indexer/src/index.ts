import {
  startListener,
  stopListener,
  waitForListenerDrain,
  getListenerHealth,
} from "./listener";
import { runKeeper, sweepLongPastDue, RECEIPT_TIMEOUT_MS } from "./keeper";
import {
  runTrialConverterTick,
  runTrialReminderTick,
  runTrialStartedEmailTick,
} from "./trial-converter";
import { runCheckoutRecoveryTick } from "./abandonment";
import { config, deployments, parsePositiveIntEnv } from "./config";
import { createDb } from "@paylix/db/client";
import { systemStatus } from "@paylix/db/schema";
import { retryFailedWebhooks } from "./webhook-dispatch";
import { retryUnmatchedEvents } from "./handlers";
import { startAlertsLoop } from "./alerts";

// Shutdown state lives at module scope so the signal handlers can be installed
// before the (potentially long) startup backfill finishes.
let shuttingDown = false;
let keeperTick: Promise<void> | null = null;

async function main() {
  console.log("=================================");
  console.log("  Paylix Indexer + Keeper");
  console.log(`  Deployments: ${deployments.length}`);
  for (const d of deployments) {
    console.log(`    - ${d.networkKey} (${d.livemode ? "live" : "test"})`);
  }
  console.log("=================================");

  // Heartbeat must start BEFORE the listener — startListener() blocks on a
  // potentially long backfill (up to MAX_BACKFILL_BLOCKS / chunk_size chunks
  // per contract with throttle delays), and we want the dashboard to show
  // "online" for the entire duration the process is alive and working.
  const db = createDb(config.databaseUrl);

  // Indexer lifecycle has three states:
  //   "starting" — process alive and backfilling; can't yet receive new events
  //   "ok"       — listener watchers installed; ready for live events
  //   "degraded" — process alive but the listener poll loop is failing or a
  //                block range was skipped; events are NOT flowing
  // The sidebar distinguishes these so users don't try to pay through a
  // still-warming-up (or stalled) indexer.
  let indexerStatus: "starting" | "ok" = "starting";

  async function sendHeartbeat() {
    // Never report "ok" while the listener isn't actually indexing — the
    // dashboard would show green with no events flowing.
    const value =
      indexerStatus === "ok" && getListenerHealth() === "degraded"
        ? "degraded"
        : indexerStatus;
    try {
      await db
        .insert(systemStatus)
        .values({ key: "indexer_heartbeat", value })
        .onConflictDoUpdate({
          target: systemStatus.key,
          set: { value, updatedAt: new Date() },
        });
    } catch (err) {
      console.error("[Heartbeat] Failed:", err);
    }
  }

  await sendHeartbeat();
  setInterval(sendHeartbeat, 30 * 1000);
  console.log("[Heartbeat] Sending every 30 seconds (status: starting).");

  // Graceful shutdown: a container stop must not kill the process mid-charge or
  // mid-chunk. Stop the poll loops, let the in-flight keeper tick and poll pass
  // finish, then exit. The hard timeout bounds how long we wait. Installed
  // before the backfill so a stop during startup is honoured too.
  // Must outlast a keeper charge that is waiting on a receipt: cutting that
  // short exits with nextChargeDate already bumped and no dunning write, which
  // hands the subscriber a free billing period.
  const SHUTDOWN_TIMEOUT_MS = RECEIPT_TIMEOUT_MS + 30_000;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Indexer] ${signal} received, draining...`);
    stopListener();
    const drain = (async () => {
      await waitForListenerDrain();
      if (keeperTick) {
        console.log("[Indexer] Waiting for the in-flight keeper tick...");
        await keeperTick.catch(() => {});
      }
    })();
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), SHUTDOWN_TIMEOUT_MS),
    );
    const outcome = await Promise.race([drain.then(() => "drained" as const), timeout]);
    if (outcome === "timeout") {
      console.error(
        `[Indexer] Drain did not finish within ${SHUTDOWN_TIMEOUT_MS}ms, exiting anyway`,
      );
    }
    indexerStatus = "starting";
    await sendHeartbeat();
    console.log("[Indexer] Shutdown complete.");
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await startListener();
  await runKeeper();

  // Listener backfill + watchers are up — flip to ok and push a heartbeat
  // immediately so the dashboard turns green without waiting 30 seconds.
  indexerStatus = "ok";
  await sendHeartbeat();
  console.log("[Heartbeat] Status: ok (listener ready).");

  // Keeper interval: prefer KEEPER_INTERVAL_MS (millisecond override) for
  // short intervals (e.g. testing with the "minutely" billing interval),
  // otherwise fall back to KEEPER_INTERVAL_MINUTES.
  const keeperIntervalMs = parsePositiveIntEnv("KEEPER_INTERVAL_MS", 30000);

  // Recursive setTimeout + running flag prevents overlapping keeper runs
  // from double-charging subscriptions when a run takes longer than the
  // interval.
  let keeperRunning = false;

  async function scheduleKeeper() {
    if (shuttingDown) return;
    if (keeperRunning) {
      setTimeout(scheduleKeeper, keeperIntervalMs);
      return;
    }
    keeperRunning = true;
    keeperTick = (async () => {
      try {
        await runKeeper();
        await sweepLongPastDue().catch((err) => {
          console.error("[Indexer] sweepLongPastDue failed:", err);
        });
        await runTrialConverterTick().catch((err) => {
          console.error("[Indexer] trial converter failed:", err);
        });
        await runTrialReminderTick().catch((err) => {
          console.error("[Indexer] trial reminder failed:", err);
        });
        await runTrialStartedEmailTick().catch((err) => {
          console.error("[Indexer] trial started email failed:", err);
        });
        await runCheckoutRecoveryTick().catch((err) => {
          console.error("[Indexer] checkout recovery failed:", err);
        });
      } catch (err) {
        console.error("[Keeper] Unhandled error:", err);
      } finally {
        keeperRunning = false;
        keeperTick = null;
        if (!shuttingDown) setTimeout(scheduleKeeper, keeperIntervalMs);
      }
    })();
    await keeperTick;
  }

  setTimeout(scheduleKeeper, keeperIntervalMs);
  console.log(`[Keeper] Scheduled every ${keeperIntervalMs}ms`);

  // Webhook retry sweep: re-deliver failed webhook deliveries whose
  // nextRetryAt has elapsed (bounded to 5 attempts total).
  setInterval(() => {
    retryFailedWebhooks().catch((err) =>
      console.error("[Webhook Retry] Error:", err)
    );
  }, 60 * 1000);
  console.log("[Webhook Retry] Scheduled every 60s");

  // Unmatched event retry sweep: re-runs handlers for events that arrived
  // before the corresponding checkout session was committed. Bounded to 50
  // per tick.
  setInterval(() => {
    retryUnmatchedEvents().catch((err) =>
      console.error("[Unmatched Retry] Error:", err)
    );
  }, 30 * 1000);
  console.log("[Unmatched Retry] Scheduled every 30s");

  // Balance monitoring for relayer + keeper wallets. Fires system.* webhook
  // events when either drops below the low-balance threshold.
  startAlertsLoop();

  console.log("[Indexer] Running. Press Ctrl+C to stop.");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
