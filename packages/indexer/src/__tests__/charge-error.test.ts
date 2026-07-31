import { describe, it, expect } from "vitest";
import { classifyChargeFailure } from "../charge-error";

describe("classifyChargeFailure", () => {
  it("classifies a USDC blacklist revert as token-level", () => {
    // FiatTokenV2: payability is pre-checked on-chain, so allowance and balance
    // both pass and the revert happens inside transferFrom.
    expect(
      classifyChargeFailure(
        new Error(
          'The contract function "chargeSubscription" reverted with the following reason:\nBlacklistable: account is blacklisted',
        ),
      ),
    ).toBe("token_blocked");
  });

  it("classifies a paused token as token-level", () => {
    expect(classifyChargeFailure(new Error("execution reverted: Pausable: paused"))).toBe(
      "token_blocked",
    );
  });

  it("classifies frozen/blocked account wording as token-level", () => {
    expect(classifyChargeFailure(new Error("account is frozen"))).toBe("token_blocked");
    expect(classifyChargeFailure(new Error("recipient is blocked"))).toBe("token_blocked");
  });

  it("does NOT read our own contract pause as a token block", () => {
    // OZ v5 pauses with the custom error EnforcedPause(); punishing the
    // subscriber for an operator pause would be wrong.
    expect(classifyChargeFailure(new Error("reverted with custom error EnforcedPause()"))).toBe(
      "transient",
    );
  });

  it("classifies RPC and relayer trouble as transient", () => {
    expect(classifyChargeFailure(new Error("timed out waiting for receipt"))).toBe("transient");
    expect(classifyChargeFailure(new Error("429 Too Many Requests"))).toBe("transient");
    expect(classifyChargeFailure(new Error("socket hang up"))).toBe("transient");
    expect(classifyChargeFailure(new Error("nonce too low"))).toBe("transient");
    expect(classifyChargeFailure(new Error("insufficient funds for gas * price + value"))).toBe(
      "transient",
    );
  });

  it("falls back to unknown for anything unrecognised", () => {
    expect(classifyChargeFailure(new Error("execution reverted"))).toBe("unknown");
    expect(classifyChargeFailure(undefined)).toBe("unknown");
    expect(classifyChargeFailure("")).toBe("unknown");
  });
});
