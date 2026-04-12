import { startListener } from "./listener";
import { runKeeper } from "./keeper";
import { runTrialConverterTick, runTrialReminderTick } from "./trial-converter";
import { config } from "./config";
import { createDb } from "@paylix/db/client";
import { systemStatus } from "@paylix/db/schema";
import { retryFailedWebhooks } from "./webhook-dispatch";
import { retryUnmatchedEvents } from "./handlers";
import { startAlertsLoop } from "./alerts";

async function main() {
  console.log("=================================");
  console.log("  Paylix Indexer + Keeper");
  console.log(`  Network: ${config.networkKey}`);
  console.log("=================================");

  // Heartbeat must start BEFORE the listener — startListener() blocks on a
  // potentially long backfill (up to MAX_BACKFILL_BLOCKS / chunk_size chunks
  // per contract with throttle delays), and we want the dashboard to show
  // "online" for the entire duration the process is alive and working.
  const db = createDb(config.databaseUrl);

  // Indexer lifecycle has two states:
  //   "starting" — process alive and backfilling; can't yet receive new events
  //   "ok"       — listener watchers installed; ready for live events
  // The sidebar distinguishes these so users don't try to pay through a
  // still-warming-up indexer.
  let indexerStatus: "starting" | "ok" = "starting";

  async function sendHeartbeat() {
    try {
      await db
        .insert(systemStatus)
        .values({ key: "indexer_heartbeat", value: indexerStatus })
        .onConflictDoUpdate({
          target: systemStatus.key,
          set: { value: indexerStatus, updatedAt: new Date() },
        });
    } catch (err) {
      console.error("[Heartbeat] Failed:", err);
    }
  }

  await sendHeartbeat();
  setInterval(sendHeartbeat, 30 * 1000);
  console.log("[Heartbeat] Sending every 30 seconds (status: starting).");

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
  const keeperIntervalMs = parseInt(
    process.env.KEEPER_INTERVAL_MS ?? "30000",
    10
  );

  // Recursive setTimeout + running flag prevents overlapping keeper runs
  // from double-charging subscriptions when a run takes longer than the
  // interval.
  let keeperRunning = false;

  async function scheduleKeeper() {
    if (keeperRunning) {
      setTimeout(scheduleKeeper, keeperIntervalMs);
      return;
    }
    keeperRunning = true;
    try {
      await runKeeper();
      await runTrialConverterTick().catch((err) => {
        console.error("[Indexer] trial converter failed:", err);
      });
      await runTrialReminderTick().catch((err) => {
        console.error("[Indexer] trial reminder failed:", err);
      });
    } catch (err) {
      console.error("[Keeper] Unhandled error:", err);
    } finally {
      keeperRunning = false;
      setTimeout(scheduleKeeper, keeperIntervalMs);
    }
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
