import { describe, it, expect } from "vitest";
import { checkIntentCompatibility, type TrialRow } from "../trial-converter";

function row(intentOverrides: Record<string, unknown> = {}, contractAddress = "0xmanager"): TrialRow {
  return {
    id: "sub-1",
    subscriberAddress: "0xbuyer",
    contractAddress,
    intervalSeconds: 2592000,
    trialConversionAttempts: 0,
    pendingPermitSignature: {
      permit: { value: "1000000", deadline: 9999999999, v: 27, r: "0xr", s: "0xs" },
      intent: {
        merchantId: "0xmerchant",
        amount: "1000000",
        interval: 2592000,
        nonce: "n1",
        deadline: 9999999999,
        signature: "0xsig",
        productIdBytes: `0x${"11".repeat(32)}`,
        customerIdBytes: `0x${"22".repeat(32)}`,
        maxFeeBps: "50",
        flow: 1,
        ...intentOverrides,
      },
      priceSnapshot: { networkKey: "base-sepolia", tokenSymbol: "USDC", amount: "1000000" },
    },
  } as unknown as TrialRow;
}

describe("checkIntentCompatibility", () => {
  it("accepts an intent signed under the current typehash", () => {
    const result = checkIntentCompatibility(row(), "0xmanager");
    expect(result).toEqual({ replayable: true, maxFeeBps: 50n });
  });

  it("rejects an intent with no maxFeeBps (signed under the old typehash)", () => {
    const legacy = row();
    delete (legacy.pendingPermitSignature!.intent as { maxFeeBps?: unknown }).maxFeeBps;
    const result = checkIntentCompatibility(legacy, "0xmanager");
    expect(result.replayable).toBe(false);
    expect((result as { detail: string }).detail).toContain("maxFeeBps");
  });

  it("rejects an intent whose maxFeeBps is null", () => {
    expect(checkIntentCompatibility(row({ maxFeeBps: null }), "0xmanager").replayable).toBe(false);
  });

  it("rejects an intent signed against a retired SubscriptionManager", () => {
    const result = checkIntentCompatibility(row({}, "0xOLD"), "0xnew");
    expect(result.replayable).toBe(false);
    expect((result as { detail: string }).detail).toContain("retired");
  });

  it("compares manager addresses case-insensitively", () => {
    expect(checkIntentCompatibility(row({}, "0xMaNaGeR"), "0xmanager").replayable).toBe(true);
  });

  it("skips the manager check when the configured address is unknown", () => {
    expect(checkIntentCompatibility(row({}, "0xanything"), null).replayable).toBe(true);
  });

  it("rejects an intent signed for a different settlement flow", () => {
    // FLOW_PERMIT2 = 2. Replaying it through the EIP-2612 entrypoint would be a
    // flow mismatch — exactly what binding `flow` into the digest prevents.
    const result = checkIntentCompatibility(row({ flow: 2 }), "0xmanager");
    expect(result.replayable).toBe(false);
    expect((result as { detail: string }).detail).toContain("flow");
  });

  it("accepts an intent that omits flow (contract substitutes FLOW_EIP2612)", () => {
    const noFlow = row();
    delete (noFlow.pendingPermitSignature!.intent as { flow?: unknown }).flow;
    expect(checkIntentCompatibility(noFlow, "0xmanager").replayable).toBe(true);
  });

  it("rejects a non-integer maxFeeBps rather than submitting garbage", () => {
    expect(checkIntentCompatibility(row({ maxFeeBps: "not-a-number" }), "0xmanager").replayable).toBe(
      false,
    );
  });

  it("rejects a row with no stored signature", () => {
    const bare = { ...row(), pendingPermitSignature: null } as TrialRow;
    expect(checkIntentCompatibility(bare, "0xmanager").replayable).toBe(false);
  });
});
