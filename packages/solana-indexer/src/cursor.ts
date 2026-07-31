/**
 * Durable slot cursor for the Solana listener.
 *
 * Same role and same storage as the EVM indexer's block cursor
 * (packages/indexer/src/cursor.ts): one `system_status` row per watched
 * program, holding the last slot whose signatures were fully processed.
 * Without it, every event emitted while the process is down or while the
 * `onLogs` WebSocket is reconnecting is lost permanently — see IDX-03.
 *
 * Keys follow the EVM `cursor_*` convention and are scoped by network so a
 * mainnet and a devnet process can share one database.
 */

import { eq } from "drizzle-orm";
import type { Database } from "@paylix/db/client";
import { systemStatus } from "@paylix/db/schema";

/** Gap entries retained per program before the oldest are trimmed. */
const MAX_RECORDED_GAPS = 50;

export interface SlotCursor {
  /** Last fully-processed slot for `programId`, or null when never set. */
  get(programId: string): Promise<number | null>;
  /** Advance the cursor. Only ever called after the slot's work succeeded. */
  set(programId: string, slot: number): Promise<void>;
  /**
   * Record a slot range the catch-up pass could not enumerate, so an
   * operator can run a manual backfill instead of discovering the hole from
   * a customer complaint.
   */
  recordGap(programId: string, fromSlot: number, toSlot: number): Promise<void>;
}

export function makeSlotCursor(db: Database, networkKey: string): SlotCursor {
  const cursorKey = (programId: string) => `cursor_${networkKey}_${programId}`;
  const gapKey = (programId: string) => `backfill_gap_${networkKey}_${programId}`;

  async function put(key: string, value: string): Promise<void> {
    await db
      .insert(systemStatus)
      .values({ key, value })
      .onConflictDoUpdate({
        target: systemStatus.key,
        set: { value, updatedAt: new Date() },
      });
  }

  return {
    async get(programId: string): Promise<number | null> {
      const [row] = await db
        .select()
        .from(systemStatus)
        .where(eq(systemStatus.key, cursorKey(programId)));
      if (!row?.value) return null;
      const slot = Number(row.value);
      if (!Number.isFinite(slot) || slot < 0) {
        throw new Error(
          `Corrupt slot cursor ${cursorKey(programId)}: ${JSON.stringify(row.value)}`,
        );
      }
      return Math.floor(slot);
    },

    async set(programId: string, slot: number): Promise<void> {
      await put(cursorKey(programId), String(slot));
    },

    async recordGap(programId: string, fromSlot: number, toSlot: number): Promise<void> {
      // Append. Overwriting a single key meant a second truncation erased the
      // record of the first, so an operator backfilling from it would silently
      // miss a range.
      const key = gapKey(programId);
      const [row] = await db.select().from(systemStatus).where(eq(systemStatus.key, key));
      let gaps: unknown[] = [];
      if (row?.value) {
        try {
          const parsed: unknown = JSON.parse(row.value);
          gaps = Array.isArray(parsed) ? parsed : [parsed];
        } catch (err) {
          console.error(`[solana-cursor] ${key} is not valid JSON, starting a new list:`, err);
        }
      }
      gaps.push({ fromSlot, toSlot, recordedAt: new Date().toISOString() });
      // Bound the row so a pathological loop can't grow it without limit; the
      // oldest entries are the ones an operator has had longest to act on.
      if (gaps.length > MAX_RECORDED_GAPS) gaps = gaps.slice(-MAX_RECORDED_GAPS);
      await put(key, JSON.stringify(gaps));
    },
  };
}
