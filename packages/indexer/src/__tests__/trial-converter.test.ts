import { describe, it, expect, vi, beforeEach } from "vitest";
import { convertExpiredTrials, MAX_TRIAL_CONVERSION_ATTEMPTS } from "../trial-converter";

const writeContract = vi.fn();
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
      },
      priceSnapshot: { networkKey: "base-sepolia", tokenSymbol: "USDC", amount: "1000000" },
    },
    ...overrides,
  };
}

describe("convertExpiredTrials", () => {
  beforeEach(() => {
    writeContract.mockReset();
    updateSub.mockReset();
    sendMail.mockReset();
  });

  it("calls createSubscriptionWithPermit for each expired trial", async () => {
    writeContract.mockResolvedValueOnce("0xtxhash");
    const result = await convertExpiredTrials({
      rows: [makeRow()],
      writeContract,
      updateSub,
      sendMail,
      resolveUsdcAddress: () => "0xusdc",
    });
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
  });

  it("passes stored productIdBytes and customerIdBytes in the contract call", async () => {
    writeContract.mockResolvedValueOnce("0xtxhash");
    await convertExpiredTrials({
      rows: [makeRow()],
      writeContract,
      updateSub,
      sendMail,
      resolveUsdcAddress: () => "0xusdc",
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
      updateSub,
      sendMail,
      resolveUsdcAddress: () => "0xusdc",
    });
    expect(updateSub).toHaveBeenCalledWith("sub-2", expect.objectContaining({
      status: "trial_conversion_failed",
      trialConversionLastError: "permit_expired",
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
      updateSub,
      sendMail,
      resolveUsdcAddress: () => "0xusdc",
    });
    expect(updateSub).toHaveBeenCalledWith("sub-3", expect.objectContaining({
      trialConversionAttempts: 1,
      trialConversionLastError: "insufficient_balance",
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
      updateSub,
      sendMail,
      resolveUsdcAddress: () => "0xusdc",
    });
    expect(updateSub).toHaveBeenCalledWith("sub-4", expect.objectContaining({
      status: "trial_conversion_failed",
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      template: "trial-conversion-failed",
    }));
  });

  it("flips null pendingPermitSignature rows to failed immediately", async () => {
    await convertExpiredTrials({
      rows: [makeRow({ id: "sub-5", pendingPermitSignature: null as never })],
      writeContract,
      updateSub,
      sendMail,
      resolveUsdcAddress: () => "0xusdc",
    });
    expect(writeContract).not.toHaveBeenCalled();
    expect(updateSub).toHaveBeenCalledWith("sub-5", expect.objectContaining({
      status: "trial_conversion_failed",
    }));
  });
});
