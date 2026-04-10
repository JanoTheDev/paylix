import { startListener } from "./listener";
import { runKeeper } from "./keeper";
import { config } from "./config";

async function main() {
  console.log("=================================");
  console.log("  Paylix Indexer + Keeper");
  console.log(`  Network: ${config.network}`);
  console.log("=================================");

  await startListener();
  await runKeeper();

  const intervalMs = config.keeperIntervalMinutes * 60 * 1000;
  setInterval(async () => {
    try {
      await runKeeper();
    } catch (error) {
      console.error("[Keeper] Unhandled error:", error);
    }
  }, intervalMs);

  console.log(`[Keeper] Scheduled every ${config.keeperIntervalMinutes} minutes`);
  console.log("[Indexer] Running. Press Ctrl+C to stop.");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
