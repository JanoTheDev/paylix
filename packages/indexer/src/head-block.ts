export type BlockTag = "finalized" | "safe" | "latest";

export const VALID_BLOCK_TAGS: BlockTag[] = ["finalized", "safe", "latest"];

/** Minimal surface of viem's PublicClient that head resolution needs. */
export interface HeadBlockClient {
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockTag: BlockTag }): Promise<{ number: bigint | null }>;
}

export async function headFromConfirmations(
  client: HeadBlockClient,
  confirmations: bigint,
): Promise<bigint> {
  const latest = await client.getBlockNumber();
  if (confirmations <= 0n) return latest;
  return latest > confirmations ? latest - confirmations : 0n;
}

/**
 * The indexer never reads from the unsafe head.
 *
 * Default mode is "latest - N confirmations". `blockTag` is the opt-in escape
 * hatch for L1 finality semantics. When the tag RPC call fails — or answers
 * with a block that has no number — we fall back to confirmations, NEVER to the
 * bare head: a single flaky RPC response must not turn the most conservative
 * configuration into the least safe one.
 *
 * `blockTag: "latest"` is the one explicit opt-in to the tip; the caller is
 * expected to warn about it at startup.
 */
export async function resolveHeadBlock(
  client: HeadBlockClient,
  options: {
    blockTag?: BlockTag;
    confirmations: bigint;
    fallbackConfirmations: bigint;
  },
): Promise<bigint> {
  const { blockTag, confirmations, fallbackConfirmations } = options;

  if (blockTag) {
    if (blockTag === "latest") return client.getBlockNumber();
    try {
      const block = await client.getBlock({ blockTag });
      if (block.number !== null && block.number !== undefined) return block.number;
      console.error(
        `[Listener] Block tag ${blockTag} returned a block with no number; ` +
          `falling back to latest - ${fallbackConfirmations} confirmations`
      );
    } catch (err) {
      console.error(
        `[Listener] Failed to read the ${blockTag} head; falling back to ` +
          `latest - ${fallbackConfirmations} confirmations:`,
        err instanceof Error ? err.message : err
      );
    }
    // Degraded, but still confirmation-protected — never the bare head.
    return headFromConfirmations(client, fallbackConfirmations);
  }

  return headFromConfirmations(client, confirmations);
}
