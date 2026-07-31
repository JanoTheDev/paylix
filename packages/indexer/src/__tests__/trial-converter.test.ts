import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  convertExpiredTrials,
  checkIntentCompatibility,
  MAX_TRIAL_CONVERSION_ATTEMPTS,
  type TrialRow,
} from "../trial-converter";

const writeContract = vi.fn();
type Receipt = { status: "success" | "reverted" };
const waitForReceipt = vi.fn(async (): Promise<Receipt> => ({ status: "success" }));
const updateSub = vi.fn();
const sendMail = vi.fn();

function makeRow(overrides: Partial<Parameters<typeof convertExpiredTrials>[0]["rows"][number]> = {}) {
  return {
    id: "sub-1",
    subscriberAddress: "0xaaaa",
    contractAddress: "0xcontract",
    intervalSeconds: 2592000,
    trialConversionAttempts: 0,
    pendingPermitSignature: {
      permit: {
        value: "1000000",
        deadline: 9999999999,
        v: 27,
        r: "0xr" as `0x${string}`,
        s: "0xs" as `0x${string}`,
      },
      intent: {
        merchantId: "0xmerchant",
        amount: "1000000",
        interval: 2592000,
        nonce: "n1",
        deadline: 9999999999,
        signature: "0xsig" as `0x${string}`,
        productIdBytes: ("0x" + "11".repeat(32)) as `0x${string}`,
        customerIdBytes: ("0x" + "22".repeat(32)) as `0x${string}`,
        // Captured at signature time since SubscriptionIntent gained the fee
        // ceiling; its absence is what marks a pre-cutover signature.
        maxFeeBps: "50",
        flow: 1,
      },
      priceSnapshot: { networkKey: "base-sepolia", tokenSymbol: "USDC", amount: "1000000" },
    },
    ...overrides,
  };
}

describe("convertExpiredTrials", () => {
  beforeEach(() => {
    writeContract.mockReset();
    waitForReceipt.mockReset();
    waitForReceipt.mockResolvedValue({ status: "success" });
    updateSub.mockReset();
    sendMail.mockReset();
  });

  it("calls createSubscriptionWithPermit for each expired trial", async () => {
    writeContract.mockResolvedValueOnce("0xtxhash");
    const result = await convertExpiredTrials({
      rows: [makeRow()],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
    });
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0, needsReauthorization: 0 });
    expect(updateSub).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ trialConversionSubmittedAt: expect.any(Date) }),
    );
  });

  it("passes stored productIdBytes and customerIdBytes in the contract call", async () => {
    writeContract.mockResolvedValueOnce("0xtxhash");
    await convertExpiredTrials({
      rows: [makeRow()],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
    });
    const firstCall = writeContract.mock.calls[0][0];
    const tuple = firstCall.args[0];
    expect(tuple.productId).toBe("0x" + "11".repeat(32));
    expect(tuple.customerId).toBe("0x" + "22".repeat(32));
  });

  it("flips to trial_conversion_failed on permit_expired immediately", async () => {
    writeContract.mockRejectedValueOnce(new Error("ERC20Permit: expired deadline"));
    await convertExpiredTrials({
      rows: [makeRow({ id: "sub-2" })],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
    });
    expect(updateSub).toHaveBeenCalledWith("sub-2", expect.objectContaining({
      status: "trial_conversion_failed",
      trialConversionLastError: expect.stringContaining("permit_expired"),
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      template: "trial-conversion-failed",
      subscriptionId: "sub-2",
    }));
  });

  it("increments attempts and retries on insufficient_balance", async () => {
    writeContract.mockRejectedValueOnce(new Error("ERC20: transfer amount exceeds balance"));
    await convertExpiredTrials({
      rows: [makeRow({ id: "sub-3" })],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
    });
    expect(updateSub).toHaveBeenCalledWith("sub-3", expect.objectContaining({
      trialConversionAttempts: 1,
      trialConversionLastError: expect.stringContaining("insufficient_balance"),
    }));
    expect(updateSub).not.toHaveBeenCalledWith("sub-3", expect.objectContaining({
      status: "trial_conversion_failed",
    }));
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("flips to trial_conversion_failed after MAX_TRIAL_CONVERSION_ATTEMPTS", async () => {
    writeContract.mockRejectedValueOnce(new Error("ERC20: transfer amount exceeds balance"));
    await convertExpiredTrials({
      rows: [makeRow({ id: "sub-4", trialConversionAttempts: MAX_TRIAL_CONVERSION_ATTEMPTS - 1 })],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
    });
    expect(updateSub).toHaveBeenCalledWith("sub-4", expect.objectContaining({
      status: "trial_conversion_failed",
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      template: "trial-conversion-failed",
    }));
  });

  it("treats a reverted conversion transaction as a failure, not a success", async () => {
    writeContract.mockResolvedValueOnce("0xtxhash");
    waitForReceipt.mockResolvedValueOnce({ status: "reverted" });
    const result = await convertExpiredTrials({
      rows: [makeRow({ id: "sub-6" })],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
    });
    expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 0, needsReauthorization: 0 });
    // Attempt counted, so the row converges on MAX_TRIAL_CONVERSION_ATTEMPTS
    // instead of being resubmitted every ten minutes forever.
    expect(updateSub).toHaveBeenCalledWith("sub-6", expect.objectContaining({
      trialConversionAttempts: 1,
    }));
    // The submission stamp stays (it guards against a duplicate resubmission
    // while the transaction is still in flight) but the row is NOT counted as
    // converted.
    expect(updateSub).toHaveBeenCalledWith("sub-6", expect.objectContaining({
      trialConversionSubmittedAt: expect.any(Date),
    }));
  });

  it("resolves the token from the stored price snapshot, not a hardcoded USDC", async () => {
    writeContract.mockResolvedValueOnce("0xtxhash");
    const resolveTokenAddress = vi.fn(() => "0xpyusd" as `0x${string}`);
    const row = makeRow({ id: "sub-7" });
    const snapshot = row.pendingPermitSignature;
    if (!snapshot) throw new Error("fixture must have a permit signature");
    snapshot.priceSnapshot.tokenSymbol = "PYUSD";
    await convertExpiredTrials({
      rows: [row],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress,
    });
    expect(resolveTokenAddress).toHaveBeenCalledWith("base-sepolia", "PYUSD");
    expect(writeContract.mock.calls[0][0].args[0].token).toBe("0xpyusd");
  });

  it("stamps trialConversionSubmittedAt BEFORE waiting for the receipt", async () => {
    // If the stamp only happened after a successful receipt, a receipt-RPC
    // timeout would leave the row outside the reselection guard: the next tick
    // resubmits, the first transaction lands, the second reverts with
    // IntentAlreadyUsed (terminal), and the buyer is charged on-chain with the
    // row flipped to trial_conversion_failed and no payment recorded.
    const order: string[] = [];
    writeContract.mockImplementationOnce(async () => {
      order.push("write");
      return "0xtxhash";
    });
    updateSub.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
      if (patch.trialConversionSubmittedAt) order.push("stamp");
    });
    waitForReceipt.mockImplementationOnce(async () => {
      order.push("receipt");
      throw new Error("timed out waiting for receipt");
    });

    await convertExpiredTrials({
      rows: [makeRow({ id: "sub-8" })],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
    });

    expect(order).toEqual(["write", "stamp", "receipt"]);
    updateSub.mockReset();
  });

  it("asks for a nonce per contract, so multi-chain rows don't share a cursor", async () => {
    // Nonces are account+chain scoped: feeding a Base nonce to an Arbitrum
    // submission produces a transaction that can never mine.
    writeContract.mockResolvedValue("0xtxhash");
    const nonces: Record<string, number> = { "0xbase": 812, "0xarb": 3 };
    const nextNonce = vi.fn(async (address: `0x${string}`) => nonces[address]);

    await convertExpiredTrials({
      rows: [
        makeRow({ id: "sub-base", contractAddress: "0xbase" }),
        makeRow({ id: "sub-arb", contractAddress: "0xarb" }),
      ],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
      nextNonce,
    });

    expect(nextNonce).toHaveBeenNthCalledWith(1, "0xbase");
    expect(nextNonce).toHaveBeenNthCalledWith(2, "0xarb");
    expect(writeContract.mock.calls[0][0].nonce).toBe(812);
    expect(writeContract.mock.calls[1][0].nonce).toBe(3);
  });

  it("passes the signed maxFeeBps through in the contract tuple", async () => {
    writeContract.mockResolvedValueOnce("0xtxhash");
    await convertExpiredTrials({
      rows: [makeRow()],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
    });
    const tuple = writeContract.mock.calls[0][0].args[0];
    expect(tuple.maxFeeBps).toBe(50n);
    // Field order is what determines the EIP-712 digest; maxFeeBps sits between
    // permitValue and deadline in CreateSubPermitParams.
    const keys = Object.keys(tuple);
    expect(keys.slice(keys.indexOf("permitValue"), keys.indexOf("deadline") + 1)).toEqual([
      "permitValue",
      "maxFeeBps",
      "deadline",
    ]);
  });

  it("never submits a pre-cutover signature and marks it needs-reauthorisation", async () => {
    // The stored intent was signed before SubscriptionIntent gained
    // maxFeeBps/flow. It can never verify, and re-signing needs the buyer, so
    // submitting it would only burn relayer gas and five attempts.
    const legacy = makeRow({ id: "sub-legacy" });
    const legacyIntent = legacy.pendingPermitSignature!.intent as Record<string, unknown>;
    // Signed before SubscriptionIntent gained these fields.
    delete legacyIntent.maxFeeBps;
    delete legacyIntent.flow;

    const report = vi.fn(async () => {});
    const result = await convertExpiredTrials({
      rows: [legacy],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
      reportReauthorizationRequired: report,
    });

    expect(writeContract).not.toHaveBeenCalled();
    expect(result.needsReauthorization).toBe(1);
    expect(updateSub).toHaveBeenCalledWith("sub-legacy", expect.objectContaining({
      status: "trial_conversion_failed",
      trialConversionAttempts: MAX_TRIAL_CONVERSION_ATTEMPTS,
      trialConversionLastError: expect.stringContaining("intent_schema_outdated"),
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: "sub-legacy",
      reason: "intent_schema_outdated",
    }));
    expect(report).toHaveBeenCalledWith([
      expect.objectContaining({ id: "sub-legacy" }),
    ]);
  });

  it("reports every affected trial once per tick, not one failure per row", async () => {
    const legacyA = makeRow({ id: "sub-a" });
    const legacyB = makeRow({ id: "sub-b" });
    for (const row of [legacyA, legacyB]) {
      delete (row.pendingPermitSignature!.intent as Record<string, unknown>).maxFeeBps;
    }
    const report = vi.fn(async () => {});

    const result = await convertExpiredTrials({
      rows: [legacyA, legacyB],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
      reportReauthorizationRequired: report,
    });

    expect(result).toMatchObject({ attempted: 2, needsReauthorization: 2, failed: 0 });
    expect(report).toHaveBeenCalledTimes(1);
    const reported = report.mock.calls[0] as unknown as [Array<{ id: string }>];
    expect(reported[0]).toHaveLength(2);
  });

  it("treats an intent signed against a retired SubscriptionManager as needing re-authorisation", async () => {
    const row = makeRow({ id: "sub-retired", contractAddress: "0xoldmanager" });
    const result = await convertExpiredTrials({
      rows: [row],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
      configuredManagerFor: () => "0xnewmanager",
    });

    expect(writeContract).not.toHaveBeenCalled();
    expect(result.needsReauthorization).toBe(1);
  });

  it("still converts when the row's manager IS the configured one", async () => {
    writeContract.mockResolvedValueOnce("0xtxhash");
    const result = await convertExpiredTrials({
      rows: [makeRow({ contractAddress: "0xCONTRACT" })],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
      configuredManagerFor: () => "0xcontract",
    });

    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ succeeded: 1, needsReauthorization: 0 });
  });

  it("flips null pendingPermitSignature rows to failed immediately", async () => {
    await convertExpiredTrials({
      rows: [makeRow({ id: "sub-5", pendingPermitSignature: null as never })],
      writeContract,
      waitForReceipt,
      updateSub,
      sendMail,
      resolveTokenAddress: () => "0xusdc",
    });
    expect(writeContract).not.toHaveBeenCalled();
    expect(updateSub).toHaveBeenCalledWith("sub-5", expect.objectContaining({
      status: "trial_conversion_failed",
    }));
  });
});
