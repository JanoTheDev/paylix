import { keccak256, stringToBytes } from "viem";

/**
 * Matching an on-chain event to a checkout session works by reversing the
 * customerId hash: the checkout client encodes keccak256(stringToBytes(
 * session.id)) as the on-chain customerId, so we hash candidate session ids
 * until one matches.
 *
 * The scan used to load a single page of 200 open sessions, which meant a
 * merchant with more than 200 concurrently open sessions could never match a
 * valid payment — the retry sweep re-ran the identical bounded scan and failed
 * identically. Paging removes that cliff. (The real fix is an indexed
 * keccak256 column on checkout_sessions; see audit/_requests-indexer-evm.md.)
 */
export const SESSION_MATCH_PAGE_SIZE = 200;
export const SESSION_MATCH_MAX_PAGES = 25; // 5,000 open sessions per merchant

export function hashSessionId(sessionId: string): string {
  return keccak256(stringToBytes(sessionId)).toLowerCase();
}

export async function findSessionByCustomerId<T extends { id: string }>(options: {
  /** On-chain customerId from the event (any case). */
  targetCustomerId: string;
  /** Loads one page of candidate sessions, newest first. */
  fetchPage: (limit: number, offset: number) => Promise<T[]>;
  pageSize?: number;
  maxPages?: number;
  /** Used in the exhaustion warning so operators can find the merchant. */
  label?: string;
}): Promise<T | null> {
  const {
    targetCustomerId,
    fetchPage,
    pageSize = SESSION_MATCH_PAGE_SIZE,
    maxPages = SESSION_MATCH_MAX_PAGES,
    label = "session match",
  } = options;

  const target = targetCustomerId.toLowerCase();

  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(pageSize, page * pageSize);
    if (rows.length === 0) return null;

    const hit = rows.find((row) => hashSessionId(row.id) === target);
    if (hit) return hit;

    // Short page means we reached the end of the candidate set.
    if (rows.length < pageSize) return null;
  }

  console.warn(
    `[Handler] ${label}: scanned ${maxPages * pageSize} open sessions without a match; ` +
      `giving up on this pass (event will be retained for retry)`,
  );
  return null;
}
