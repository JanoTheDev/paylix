import { request } from "./request";
import type { PaylixConfig } from "./types";

/**
 * What a blocklist entry matches on. Mirrors the `blocklist_type` enum in
 * `packages/db/src/schema/blocklist-entries.ts`.
 */
export type BlocklistType = "wallet" | "email" | "country";

export interface BlocklistEntry {
  id: string;
  type: BlocklistType;
  /** Wallet address, email address, or ISO 3166-1 alpha-2 country code. */
  value: string;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface AddBlocklistEntryParams {
  type: BlocklistType;
  /**
   * Wallet address, email address, or ISO 3166-1 alpha-2 country code.
   * Matching is case-insensitive; Gmail addresses are normalized before
   * comparison (dots stripped, `+tag` removed).
   */
  value: string;
  /** Free-text note shown in the dashboard. */
  reason?: string;
}

/** Lists every blocklist entry for the current mode (test or live). */
export async function listBlocklist(
  config: PaylixConfig,
): Promise<BlocklistEntry[]> {
  return request<BlocklistEntry[]>(config, "GET", "/api/blocklist");
}

/**
 * Blocks a wallet, email, or country from completing checkout. Takes
 * effect on the next checkout attempt; sessions already in flight are
 * unaffected.
 */
export async function addBlocklistEntry(
  config: PaylixConfig,
  params: AddBlocklistEntryParams,
): Promise<BlocklistEntry> {
  return request<BlocklistEntry>(config, "POST", "/api/blocklist", {
    body: params,
  });
}

/** Removes a blocklist entry, unblocking the value immediately. */
export async function removeBlocklistEntry(
  config: PaylixConfig,
  id: string,
): Promise<void> {
  await request<void>(
    config,
    "DELETE",
    `/api/blocklist/${encodeURIComponent(id)}`,
  );
}
