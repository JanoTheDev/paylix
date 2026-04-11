import {
  createPublicClient,
  http,
  parseAbiItem,
  type Log,
  type PublicClient,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { config } from "./config";
import { getLastBlock, setLastBlock } from "./cursor";
import {
  handlePaymentReceived,
  handleSubscriptionCreated,
  handleSubscriptionPaymentReceived,
  handleSubscriptionPastDue,
  handleSubscriptionCancelled,
} from "./handlers";

// Indexer never reads from the unsafe head. The default model is "N
// confirmations": process events from blocks where (latest - block.number) >=
// INDEXER_CONFIRMATIONS. On Base, blocks come every 2s, so the default of 5
// confirmations gives ~10s of reorg protection — long enough that a sequencer
// hiccup can't pull the rug, short enough that merchants get near-instant
// "payment received" UX. This is the same trade-off Stripe makes (they ack
// card auth immediately, don't wait for settlement). Set INDEXER_CONFIRMATIONS
// higher for more paranoia, or to 0 for instant (no reorg protection — only
// safe on devnets).
//
// The block-tag mode is kept as an escape hatch for self-hosters who want
// L1 finality semantics: set INDEXER_BLOCK_TAG=finalized (~12min lag on Base)
// or INDEXER_BLOCK_TAG=safe (~6min lag). When set, the tag takes precedence
// over INDEXER_CONFIRMATIONS.
type BlockTag = "finalized" | "safe" | "latest";
const BLOCK_TAG: BlockTag | undefined = process.env.INDEXER_BLOCK_TAG as
  | BlockTag
  | undefined;
const CONFIRMATIONS = BigInt(
  parseInt(process.env.INDEXER_CONFIRMATIONS || "5", 10)
);

async function getHeadBlock(client: PublicClient): Promise<bigint> {
  // Explicit tag override path
  if (BLOCK_TAG) {
    if (BLOCK_TAG === "latest") return client.getBlockNumber();
    try {
      const block = await client.getBlock({ blockTag: BLOCK_TAG });
      return block.number ?? (await client.getBlockNumber());
    } catch {
      return client.getBlockNumber();
    }
  }

  // Default path: latest minus N confirmations
  const latest = await client.getBlockNumber();
  if (CONFIRMATIONS <= 0n) return latest;
  return latest > CONFIRMATIONS ? latest - CONFIRMATIONS : 0n;
}

// Human-readable description for the startup log
const HEAD_MODE = BLOCK_TAG
  ? `block tag ${BLOCK_TAG}`
  : `${CONFIRMATIONS} confirmations`;

const paymentReceivedEvent = parseAbiItem(
  "event PaymentReceived(address indexed payer, address indexed merchant, address token, uint256 amount, uint256 fee, bytes32 productId, bytes32 customerId, uint256 timestamp)"
);

const subscriptionCreatedEvent = parseAbiItem(
  "event SubscriptionCreated(uint256 indexed subscriptionId, address indexed subscriber, address indexed merchant, address token, uint256 amount, uint256 interval, bytes32 productId, bytes32 customerId)"
);

const subscriptionPaymentReceivedEvent = parseAbiItem(
  "event PaymentReceived(uint256 indexed subscriptionId, address indexed subscriber, address indexed merchant, address token, uint256 amount, uint256 fee, uint256 timestamp)"
);

const subscriptionPastDueEvent = parseAbiItem(
  "event SubscriptionPastDue(uint256 indexed subscriptionId)"
);

const subscriptionCancelledEvent = parseAbiItem(
  "event SubscriptionCancelled(uint256 indexed subscriptionId)"
);

function getChain() {
  return config.network === "base" ? base : baseSepolia;
}

function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate limit|too many requests|exceeded|throttle/i.test(msg);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wraps an RPC call with exponential backoff on rate-limit errors. Non-rate-limit
 * errors are thrown immediately so they can be handled as genuine failures.
 */
async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 6
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (!isRateLimitError(err) || attempt >= maxAttempts) throw err;
      const delayMs = Math.min(30_000, 500 * 2 ** (attempt - 1));
      console.warn(
        `[Listener] ${label}: rate-limited, backing off ${delayMs}ms (attempt ${attempt}/${maxAttempts})`
      );
      await sleep(delayMs);
    }
  }
}

type ContractSpec = {
  key: string;
  address: `0x${string}`;
  event: ReturnType<typeof parseAbiItem>;
  eventName: string;
  handle: (log: Log, args: any) => Promise<void>;
};

export async function startListener() {
  const chain = getChain();

  // Polling interval for the live loop. Each tick fetches getLogs once per
  // contract — with the finalized tag we don't need a tight loop because the
  // finalized head only advances every ~12s on Base anyway.
  const livePollMs = parseInt(process.env.RPC_POLL_INTERVAL_MS || "12000", 10);

  const client = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  }) as unknown as PublicClient;

  console.log(`[Listener] Watching events on ${chain.name}...`);
  console.log(`[Listener] PaymentVault: ${config.paymentVaultAddress}`);
  console.log(`[Listener] SubscriptionManager: ${config.subscriptionManagerAddress}`);
  console.log(`[Listener] Head mode: ${HEAD_MODE}`);

  const contracts: ContractSpec[] = [
    {
      key: "payment_vault_payment_received",
      address: config.paymentVaultAddress,
      event: paymentReceivedEvent,
      eventName: "PaymentReceived",
      handle: (log, args) => handlePaymentReceived(log, args),
    },
    {
      key: "subscription_manager_subscription_created",
      address: config.subscriptionManagerAddress,
      event: subscriptionCreatedEvent,
      eventName: "SubscriptionCreated",
      handle: (log, args) => handleSubscriptionCreated(log, args),
    },
    {
      key: "subscription_manager_payment_received",
      address: config.subscriptionManagerAddress,
      event: subscriptionPaymentReceivedEvent,
      eventName: "PaymentReceived",
      handle: (log, args) => handleSubscriptionPaymentReceived(log, args),
    },
    {
      key: "subscription_manager_subscription_past_due",
      address: config.subscriptionManagerAddress,
      event: subscriptionPastDueEvent,
      eventName: "SubscriptionPastDue",
      handle: (log, args) => handleSubscriptionPastDue(log, args),
    },
    {
      key: "subscription_manager_subscription_cancelled",
      address: config.subscriptionManagerAddress,
      event: subscriptionCancelledEvent,
      eventName: "SubscriptionCancelled",
      handle: (log, args) => handleSubscriptionCancelled(log, args),
    },
  ];

  const currentBlock = await getHeadBlock(client);
  console.log(`[Listener] Current head (${HEAD_MODE}): ${currentBlock}`);

  // Chunk size for backfill — Alchemy free tier limits eth_getLogs to 10 blocks.
  // Tunable via env for paid plans.
  const BACKFILL_CHUNK = BigInt(
    parseInt(process.env.BACKFILL_CHUNK_SIZE || "10", 10)
  );
  // Cap total blocks to backfill on cold start (avoid hammering RPC after long downtime).
  const MAX_BACKFILL_BLOCKS = BigInt(
    parseInt(process.env.MAX_BACKFILL_BLOCKS || "5000", 10)
  );
  // Delay between backfill chunks to stay under free-tier CU/sec budgets.
  const BACKFILL_DELAY_MS = parseInt(
    process.env.BACKFILL_DELAY_MS || "250",
    10
  );

  // Process a [fromBlock, toBlock] window for one contract in chunks. Used by
  // both the cold-start backfill and the live polling loop. Returns the last
  // block successfully processed (so the cursor lands on a confirmed point).
  async function processWindow(
    spec: ContractSpec,
    fromBlock: bigint,
    toBlock: bigint,
    label: string
  ): Promise<{ totalLogs: number; lastProcessed: bigint }> {
    let totalLogs = 0;
    let cursor = fromBlock;
    let lastProcessed = fromBlock - 1n;

    while (cursor <= toBlock) {
      const chunkEnd =
        cursor + BACKFILL_CHUNK - 1n > toBlock ? toBlock : cursor + BACKFILL_CHUNK - 1n;

      try {
        const logs = await withRateLimitRetry(
          () =>
            client.getLogs({
              address: spec.address,
              event: spec.event as any,
              fromBlock: cursor,
              toBlock: chunkEnd,
            }),
          `${spec.key} ${cursor}-${chunkEnd}`
        );

        totalLogs += logs.length;

        for (const log of logs) {
          try {
            await spec.handle(log as Log, (log as any).args);
          } catch (err) {
            console.error(
              `[Listener] Error handling ${label} ${spec.eventName}:`,
              err
            );
          }
        }

        await setLastBlock(spec.key, chunkEnd);
        lastProcessed = chunkEnd;
      } catch (err) {
        if (isRateLimitError(err)) {
          console.error(
            `[Listener] Chunk ${cursor}-${chunkEnd} for ${spec.key} still rate-limited after retries, stopping ${label} for this contract`
          );
          break;
        }
        console.error(
          `[Listener] Chunk ${cursor}-${chunkEnd} failed for ${spec.key}, skipping:`,
          err instanceof Error ? err.message : err
        );
        // Genuine poisoned chunk — advance so we don't get stuck on it.
        await setLastBlock(spec.key, chunkEnd);
        lastProcessed = chunkEnd;
      }

      cursor = chunkEnd + 1n;
      if (BACKFILL_DELAY_MS > 0) await sleep(BACKFILL_DELAY_MS);
    }

    return { totalLogs, lastProcessed };
  }

  // Backfill each contract up to the current finalized block. The five
  // contracts are independent, so we run them concurrently.
  await Promise.all(contracts.map(async (spec) => {
    try {
      const lastBlock = await getLastBlock(spec.key);
      let fromBlock = lastBlock !== null ? lastBlock + 1n : currentBlock;

      // Cap how far back we go on first run / after long downtime.
      if (currentBlock - fromBlock > MAX_BACKFILL_BLOCKS) {
        fromBlock = currentBlock - MAX_BACKFILL_BLOCKS;
        console.log(
          `[Listener] ${spec.key}: capped backfill window to last ${MAX_BACKFILL_BLOCKS} blocks`
        );
      }

      if (fromBlock > currentBlock) {
        console.log(
          `[Listener] ${spec.key}: cursor ${lastBlock} ahead of head ${currentBlock}, nothing to backfill`
        );
        await setLastBlock(spec.key, currentBlock);
        return;
      }

      console.log(
        `[Listener] ${spec.key}: backfilling ${fromBlock} -> ${currentBlock} (chunk size ${BACKFILL_CHUNK})`
      );

      const { totalLogs } = await processWindow(spec, fromBlock, currentBlock, "backfill");
      console.log(`[Listener] ${spec.key}: backfill complete (${totalLogs} events)`);
    } catch (err) {
      console.error(`[Listener] Backfill failed for ${spec.key}:`, err);
    }
  }));

  // Live polling loop. On each tick we re-read the finalized head and process
  // any new finalized blocks. Because we only ever advance to a finalized
  // block, the indexer never records an event from a reorgable tip.
  let stopped = false;
  const pollOnce = async () => {
    let head: bigint;
    try {
      head = await getHeadBlock(client);
    } catch (err) {
      console.error(`[Listener] Failed to read head block:`, err);
      return;
    }

    await Promise.all(contracts.map(async (spec) => {
      const lastBlock = await getLastBlock(spec.key);
      const fromBlock = lastBlock !== null ? lastBlock + 1n : head;
      if (fromBlock > head) return;

      try {
        await processWindow(spec, fromBlock, head, "live");
      } catch (err) {
        console.error(`[Listener] Live poll failed for ${spec.key}:`, err);
      }
    }));
  };

  const poll = async () => {
    while (!stopped) {
      await pollOnce();
      await sleep(livePollMs);
    }
  };
  poll().catch((err) => console.error("[Listener] Live loop crashed:", err));

  console.log("[Listener] Live polling loop started.");
}
