import {
  createPublicClient,
  http,
  parseAbiItem,
  type Log,
  type PublicClient,
} from "viem";
import {
  deployments,
  parseNonNegativeIntEnv,
  parsePositiveIntEnv,
} from "./config";
import type { Deployment } from "@paylix/config/deployments";
import { getLastBlock, setLastBlock, recordBackfillGap } from "./cursor";
import {
  resolveHeadBlock,
  VALID_BLOCK_TAGS,
  type BlockTag,
  type HeadBlockClient,
} from "./head-block";
import { processWindow } from "./process-window";
import { sleep, withRateLimitRetry } from "./rpc-retry";
import {
  handlePaymentReceived,
  handleSubscriptionCreated,
  handleSubscriptionPaymentReceived,
  handleSubscriptionPastDue,
  handleSubscriptionCancelled,
  retainFailedEvent,
  type HandlerContext,
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
const rawBlockTag = process.env.INDEXER_BLOCK_TAG?.trim();
if (rawBlockTag && !VALID_BLOCK_TAGS.includes(rawBlockTag as BlockTag)) {
  throw new Error(
    `[Listener] INDEXER_BLOCK_TAG must be one of ${VALID_BLOCK_TAGS.join("|")}, got "${rawBlockTag}"`
  );
}
const BLOCK_TAG: BlockTag | undefined = rawBlockTag
  ? (rawBlockTag as BlockTag)
  : undefined;
const DEFAULT_CONFIRMATIONS = 5;
const CONFIRMATIONS = BigInt(
  parseNonNegativeIntEnv("INDEXER_CONFIRMATIONS", DEFAULT_CONFIRMATIONS)
);
// Used when the block-tag RPC call fails. Never fall back to the bare head:
// a flaky RPC response must not turn the most conservative configuration into
// the least safe one. If the operator explicitly set 0 confirmations we still
// hold back the default here, because they opted into a *tag*, not into the tip.
const FALLBACK_CONFIRMATIONS =
  CONFIRMATIONS > 0n ? CONFIRMATIONS : BigInt(DEFAULT_CONFIRMATIONS);

if (BLOCK_TAG === "latest") {
  console.warn(
    "[Listener] INDEXER_BLOCK_TAG=latest — reading the unconfirmed head. Reorged payments can be recorded as confirmed."
  );
}

function getHeadBlock(client: PublicClient): Promise<bigint> {
  return resolveHeadBlock(client as unknown as HeadBlockClient, {
    blockTag: BLOCK_TAG,
    confirmations: CONFIRMATIONS,
    fallbackConfirmations: FALLBACK_CONFIRMATIONS,
  });
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

/** Sleeps in short slices so a shutdown doesn't wait out a full poll interval. */
async function sleepUntilStopped(ms: number) {
  const deadline = Date.now() + ms;
  while (!stopped && Date.now() < deadline) {
    await sleep(Math.min(250, deadline - Date.now()));
  }
}

type ContractSpec = {
  key: string;
  address: `0x${string}`;
  event: ReturnType<typeof parseAbiItem>;
  eventName: string;
  /**
   * The `unmatched_events.event_type` this log is replayed as when its handler
   * throws. `null` means the event has no replay path in retryUnmatchedEvents —
   * for those we stop the window instead of retaining, so the chunk is re-read
   * from the chain on the next poll.
   */
  unmatchedType: string | null;
  handle: (log: Log, args: any) => Promise<void>;
};

// ---- Lifecycle ----
//
// A container stop must not kill the process mid-chunk. `stopListener()` flips
// the flag every poll loop checks; `waitForListenerDrain()` resolves once the
// in-flight poll passes have finished.
let stopped = false;
const inFlightPolls = new Set<Promise<void>>();

// Poll-loop health. The heartbeat in index.ts reads this so the dashboard can't
// report green while no events are being indexed.
let listenerHealth: "ok" | "degraded" = "ok";
// Latched conditions survive a subsequent successful poll: a skipped block range
// or a cursor that can't move is still a problem after the next tick succeeds,
// and clearing it 12 seconds later would hide it from the dashboard entirely.
let listenerDegradedLatched = false;
// Consecutive processWindow aborts per cursor. A handler that throws every time
// (e.g. SubscriptionCancelled with a permanently failing DB write) stops that
// cursor advancing; without this the loop would look healthy forever.
const consecutiveAborts = new Map<string, number>();
const ABORT_DEGRADE_THRESHOLD = 3;

export function getListenerHealth(): "ok" | "degraded" {
  return listenerDegradedLatched || listenerHealth === "degraded"
    ? "degraded"
    : "ok";
}

export function stopListener() {
  stopped = true;
}

export async function waitForListenerDrain(): Promise<void> {
  await Promise.allSettled(Array.from(inFlightPolls));
}

export async function startListener() {
  if (deployments.length === 0) {
    throw new Error("[Listener] No deployments configured");
  }

  console.log(`[Listener] Starting with ${deployments.length} deployment(s)`);

  // Run each deployment's listener concurrently. They're independent — separate
  // RPC clients, separate contract sets, no shared state.
  await Promise.all(deployments.map((d) => startDeploymentListener(d)));

  console.log("[Listener] All deployment listeners active.");
}

async function startDeploymentListener(deployment: Deployment) {
  const chain = deployment.chain;
  const livePollMs = parsePositiveIntEnv("RPC_POLL_INTERVAL_MS", 12000);

  const client = createPublicClient({
    chain,
    transport: http(deployment.rpcUrl),
  }) as unknown as PublicClient;

  const tag = `${deployment.networkKey}/${deployment.livemode ? "live" : "test"}`;
  console.log(`[Listener ${tag}] Watching events on ${chain.name}`);
  console.log(`[Listener ${tag}]   PaymentVault: ${deployment.paymentVault}`);
  console.log(`[Listener ${tag}]   SubscriptionManager: ${deployment.subscriptionManager}`);
  console.log(`[Listener ${tag}]   Head mode: ${HEAD_MODE}`);

  const ctx: HandlerContext = {
    livemode: deployment.livemode,
    networkKey: deployment.networkKey,
    paymentVault: deployment.paymentVault,
    subscriptionManager: deployment.subscriptionManager,
  };

  // Cursor key prefix uniquely identifies this deployment so multiple
  // deployments can coexist in the same system_status table without
  // stepping on each other. Old unprefixed cursor rows become dead data
  // on first run — we accept a one-time re-backfill rather than migrate.
  const keyPrefix = `${deployment.networkKey}_${deployment.livemode ? "live" : "test"}`;

  const contracts: ContractSpec[] = [
    {
      key: `${keyPrefix}_payment_vault_payment_received`,
      address: deployment.paymentVault,
      event: paymentReceivedEvent,
      eventName: "PaymentReceived",
      unmatchedType: "PaymentReceived",
      handle: (log, args) => handlePaymentReceived(log, args, ctx),
    },
    {
      key: `${keyPrefix}_subscription_manager_subscription_created`,
      address: deployment.subscriptionManager,
      event: subscriptionCreatedEvent,
      eventName: "SubscriptionCreated",
      unmatchedType: "SubscriptionCreated",
      handle: (log, args) => handleSubscriptionCreated(log, args, ctx),
    },
    {
      key: `${keyPrefix}_subscription_manager_payment_received`,
      address: deployment.subscriptionManager,
      event: subscriptionPaymentReceivedEvent,
      eventName: "PaymentReceived",
      unmatchedType: "SubscriptionPaymentReceived",
      handle: (log, args) => handleSubscriptionPaymentReceived(log, args, ctx),
    },
    {
      key: `${keyPrefix}_subscription_manager_subscription_past_due`,
      address: deployment.subscriptionManager,
      event: subscriptionPastDueEvent,
      eventName: "SubscriptionPastDue",
      unmatchedType: null,
      handle: (log, args) => handleSubscriptionPastDue(log, args, ctx),
    },
    {
      key: `${keyPrefix}_subscription_manager_subscription_cancelled`,
      address: deployment.subscriptionManager,
      event: subscriptionCancelledEvent,
      eventName: "SubscriptionCancelled",
      unmatchedType: null,
      handle: (log, args) => handleSubscriptionCancelled(log, args, ctx),
    },
  ];

  const currentBlock = await getHeadBlock(client);
  console.log(`[Listener ${tag}] Current head (${HEAD_MODE}): ${currentBlock}`);

  // Chunk size for backfill — Alchemy free tier limits eth_getLogs to 10 blocks.
  // Tunable via env for paid plans.
  const BACKFILL_CHUNK = BigInt(parsePositiveIntEnv("BACKFILL_CHUNK_SIZE", 10));
  // Cap total blocks to backfill on cold start (avoid hammering RPC after long downtime).
  const MAX_BACKFILL_BLOCKS = BigInt(
    parsePositiveIntEnv("MAX_BACKFILL_BLOCKS", 5000)
  );
  // Delay between backfill chunks to stay under free-tier CU/sec budgets.
  const BACKFILL_DELAY_MS = parseNonNegativeIntEnv("BACKFILL_DELAY_MS", 250);

  // Runs one [fromBlock, toBlock] window for a contract. The cursor-advancement
  // rules live in ./process-window (unit-tested there); this only wires the
  // deployment's RPC client, handler and retention path into it.
  function runWindow(spec: ContractSpec, fromBlock: bigint, toBlock: bigint, label: string) {
    return processWindow<Log>(
      {
        key: spec.key,
        label,
        eventName: spec.eventName,
        chunkSize: BACKFILL_CHUNK,
        delayMs: BACKFILL_DELAY_MS,
        isStopped: () => stopped,
        getLogs: (from, to) =>
          withRateLimitRetry(
            () =>
              client.getLogs({
                address: spec.address,
                event: spec.event as any,
                fromBlock: from,
                toBlock: to,
              }) as Promise<Log[]>,
            `${spec.key} ${from}-${to}`
          ),
        handle: (log) => spec.handle(log, (log as any).args),
        retain: (log) =>
          spec.unmatchedType
            ? retainFailedEvent(
                spec.unmatchedType,
                log,
                ((log as any).args ?? {}) as Record<string, unknown>,
                ctx
              )
            : Promise.resolve(false),
        setLastBlock: (block) => setLastBlock(spec.key, block),
        describeLog: (log) => `tx ${log.transactionHash}`,
      },
      fromBlock,
      toBlock,
    );
  }

  // Backfill each contract up to the current finalized block. The five
  // contracts are independent, so we run them concurrently.
  await Promise.all(contracts.map(async (spec) => {
    try {
      const lastBlock = await getLastBlock(spec.key);
      let fromBlock = lastBlock !== null ? lastBlock + 1n : currentBlock;

      // Cap how far back we go on first run / after long downtime. Everything
      // between the stored cursor and the new fromBlock is skipped, so on a
      // warm start (cursor exists) that gap is a data-loss event: record it
      // and alert rather than logging it as routine capping.
      if (currentBlock - fromBlock > MAX_BACKFILL_BLOCKS) {
        const cappedFrom = currentBlock - MAX_BACKFILL_BLOCKS;
        if (lastBlock !== null) {
          console.error(
            `[Listener] ${spec.key}: SKIPPING blocks ${fromBlock}-${cappedFrom - 1n} — ` +
              `cursor is further than MAX_BACKFILL_BLOCKS (${MAX_BACKFILL_BLOCKS}) behind head ${currentBlock}. ` +
              `Events in that range were never indexed; run a manual backfill.`
          );
          await recordBackfillGap(spec.key, fromBlock, cappedFrom - 1n).catch((err) =>
            console.error(`[Listener] Failed to record backfill gap for ${spec.key}:`, err)
          );
          // Latched: a successful poll 12 seconds later does not un-skip blocks.
          listenerDegradedLatched = true;
          const { dispatchSystemWebhook } = await import("./webhook-dispatch");
          await dispatchSystemWebhook("system.backfill_gap", {
            cursorKey: spec.key,
            fromBlock: fromBlock.toString(),
            toBlock: (cappedFrom - 1n).toString(),
            headBlock: currentBlock.toString(),
            maxBackfillBlocks: MAX_BACKFILL_BLOCKS.toString(),
          }).catch((err) =>
            console.error(`[Listener] Failed to dispatch backfill-gap webhook:`, err)
          );
        } else {
          console.log(
            `[Listener] ${spec.key}: cold start, capped backfill window to last ${MAX_BACKFILL_BLOCKS} blocks`
          );
        }
        fromBlock = cappedFrom;
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

      const { totalLogs } = await runWindow(spec, fromBlock, currentBlock, "backfill");
      console.log(`[Listener] ${spec.key}: backfill complete (${totalLogs} events)`);
    } catch (err) {
      console.error(`[Listener] Backfill failed for ${spec.key}:`, err);
    }
  }));

  // Live polling loop. On each tick we re-read the finalized head and process
  // any new finalized blocks. Because we only ever advance to a finalized
  // block, the indexer never records an event from a reorgable tip.
  const pollOnce = async () => {
    const head = await getHeadBlock(client);

    await Promise.all(contracts.map(async (spec) => {
      const lastBlock = await getLastBlock(spec.key);
      const fromBlock = lastBlock !== null ? lastBlock + 1n : head;
      if (fromBlock > head) return;

      try {
        const { aborted } = await runWindow(spec, fromBlock, head, "live");
        // A cursor that keeps aborting is a cursor that isn't advancing. Track
        // it per contract so a permanently throwing handler (or an RPC that
        // never returns a chunk) surfaces instead of looking healthy.
        const priorAborts = consecutiveAborts.get(spec.key) ?? 0;
        if (aborted) {
          const aborts = priorAborts + 1;
          consecutiveAborts.set(spec.key, aborts);
          if (aborts === ABORT_DEGRADE_THRESHOLD) {
            console.error(
              `[Listener] ${spec.key}: ${aborts} consecutive aborted windows — cursor is stalled at ${fromBlock - 1n}`
            );
          }
        } else if (priorAborts > 0) {
          console.log(`[Listener] ${spec.key}: window completed, cursor advancing again`);
          consecutiveAborts.set(spec.key, 0);
        }
      } catch (err) {
        console.error(`[Listener] Live poll failed for ${spec.key}:`, err);
      }
    }));
  };

  const anyCursorStalled = () =>
    Array.from(consecutiveAborts.values()).some((n) => n >= ABORT_DEGRADE_THRESHOLD);

  // The loop must survive a failing pass: a thrown error here used to leave the
  // process alive with no listener while the heartbeat kept reporting "ok".
  // Consecutive failures back off and flip the health flag the heartbeat reads.
  const poll = async () => {
    let consecutiveFailures = 0;
    while (!stopped) {
      try {
        await pollOnce();
        if (consecutiveFailures > 0) {
          console.log(`[Listener ${tag}] Poll loop recovered.`);
        }
        consecutiveFailures = 0;
        listenerHealth = anyCursorStalled() ? "degraded" : "ok";
      } catch (err) {
        consecutiveFailures += 1;
        console.error(
          `[Listener ${tag}] Poll pass failed (${consecutiveFailures} consecutive):`,
          err
        );
        if (consecutiveFailures >= 3) listenerHealth = "degraded";
      }
      const backoffMs =
        consecutiveFailures > 0
          ? Math.min(60_000, livePollMs * 2 ** Math.min(consecutiveFailures, 4))
          : livePollMs;
      await sleepUntilStopped(backoffMs);
    }
    console.log(`[Listener ${tag}] Poll loop stopped.`);
  };

  const pollPromise = poll().catch((err) => {
    // Should be unreachable — the loop catches per-pass errors — but if the
    // loop itself dies the dashboard must not keep reporting healthy.
    listenerHealth = "degraded";
    console.error(`[Listener ${tag}] Live loop crashed:`, err);
  });
  inFlightPolls.add(pollPromise);
  void pollPromise.finally(() => inFlightPolls.delete(pollPromise));

  console.log(`[Listener ${tag}] Live polling loop started.`);
}
