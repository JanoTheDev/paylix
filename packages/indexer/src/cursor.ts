import { createDb } from "@paylix/db/client";
import { systemStatus } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { config } from "./config";

const db = createDb(config.databaseUrl);

export async function getLastBlock(contractKey: string): Promise<bigint | null> {
  const [row] = await db
    .select()
    .from(systemStatus)
    .where(eq(systemStatus.key, `cursor_${contractKey}`));
  if (!row?.value) return null;
  return BigInt(row.value);
}

/**
 * Persists a block range the listener skipped (cursor further behind the head
 * than MAX_BACKFILL_BLOCKS allows). Events in that range were never indexed, so
 * an operator needs a record to decide whether to run a manual backfill.
 * Successive gaps for the same cursor are appended, newest last, capped so the
 * value can't grow without bound.
 */
export async function recordBackfillGap(
  contractKey: string,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<void> {
  const key = `backfill_gap_${contractKey}`;
  const entry = `${fromBlock}-${toBlock}@${new Date().toISOString()}`;
  const [existing] = await db
    .select()
    .from(systemStatus)
    .where(eq(systemStatus.key, key));
  const history = existing?.value ? existing.value.split(",") : [];
  history.push(entry);
  const value = history.slice(-20).join(",");
  await db
    .insert(systemStatus)
    .values({ key, value })
    .onConflictDoUpdate({
      target: systemStatus.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function setLastBlock(contractKey: string, blockNumber: bigint): Promise<void> {
  await db
    .insert(systemStatus)
    .values({ key: `cursor_${contractKey}`, value: blockNumber.toString() })
    .onConflictDoUpdate({
      target: systemStatus.key,
      set: { value: blockNumber.toString(), updatedAt: new Date() },
    });
}
