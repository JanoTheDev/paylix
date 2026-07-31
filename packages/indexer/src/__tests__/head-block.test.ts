import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveHeadBlock, type HeadBlockClient } from "../head-block";

function makeClient(overrides: Partial<HeadBlockClient> = {}): HeadBlockClient {
  return {
    getBlockNumber: vi.fn(async () => 1000n),
    getBlock: vi.fn(async () => ({ number: 900n })),
    ...overrides,
  };
}

describe("resolveHeadBlock", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("default mode holds back N confirmations from latest", async () => {
    const client = makeClient();
    await expect(
      resolveHeadBlock(client, { confirmations: 5n, fallbackConfirmations: 5n }),
    ).resolves.toBe(995n);
    expect(client.getBlock).not.toHaveBeenCalled();
  });

  it("clamps to 0 when the chain is shorter than the confirmation depth", async () => {
    const client = makeClient({ getBlockNumber: vi.fn(async () => 2n) });
    await expect(
      resolveHeadBlock(client, { confirmations: 5n, fallbackConfirmations: 5n }),
    ).resolves.toBe(0n);
  });

  it("returns the tagged block number when the tag call succeeds", async () => {
    const client = makeClient();
    await expect(
      resolveHeadBlock(client, {
        blockTag: "finalized",
        confirmations: 5n,
        fallbackConfirmations: 5n,
      }),
    ).resolves.toBe(900n);
  });

  it("NEVER returns the bare head when the block-tag call throws", async () => {
    // This is the invariant: a flaky RPC response must not turn the most
    // conservative configuration into the least safe one.
    const client = makeClient({
      getBlock: vi.fn(async () => {
        throw new Error("502 Bad Gateway");
      }),
    });
    const head = await resolveHeadBlock(client, {
      blockTag: "finalized",
      confirmations: 5n,
      fallbackConfirmations: 5n,
    });
    expect(head).toBe(995n);
    expect(head).not.toBe(1000n);
  });

  it("falls back to confirmations when the tagged block has no number", async () => {
    const client = makeClient({ getBlock: vi.fn(async () => ({ number: null })) });
    await expect(
      resolveHeadBlock(client, {
        blockTag: "safe",
        confirmations: 5n,
        fallbackConfirmations: 5n,
      }),
    ).resolves.toBe(995n);
  });

  it("still holds blocks back on tag failure when confirmations is 0", async () => {
    // Operator opted into a *tag*, not into the tip — the fallback depth is
    // the default, not their 0.
    const client = makeClient({
      getBlock: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    await expect(
      resolveHeadBlock(client, {
        blockTag: "finalized",
        confirmations: 0n,
        fallbackConfirmations: 5n,
      }),
    ).resolves.toBe(995n);
  });

  it("honours an explicit blockTag=latest opt-in", async () => {
    const client = makeClient();
    await expect(
      resolveHeadBlock(client, {
        blockTag: "latest",
        confirmations: 5n,
        fallbackConfirmations: 5n,
      }),
    ).resolves.toBe(1000n);
  });

  it("returns the raw head only when confirmations is explicitly 0", async () => {
    const client = makeClient();
    await expect(
      resolveHeadBlock(client, { confirmations: 0n, fallbackConfirmations: 5n }),
    ).resolves.toBe(1000n);
  });
});
