import { describe, it, expect, vi } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { startKeeper, type SolanaDueSubscription } from "../keeper";

function fakeDueSubscription(): SolanaDueSubscription {
  return {
    subscriptionPda: Keypair.generate().publicKey,
    subscriptionId: 42n,
    subscriberAta: Keypair.generate().publicKey,
    merchantAta: Keypair.generate().publicKey,
    platformAta: Keypair.generate().publicKey,
    mint: Keypair.generate().publicKey,
  };
}

function fakeConnection(opts: { sendShouldThrow?: boolean } = {}): Connection {
  return {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: "x".repeat(43), lastValidBlockHeight: 100 })),
    sendTransaction: vi.fn(async () => {
      if (opts.sendShouldThrow) throw new Error("simulated send failure");
      return "fakesignature";
    }),
    confirmTransaction: vi.fn(async () => ({ value: { err: null } })),
  } as unknown as Connection;
}

describe("startKeeper tick()", () => {
  it("calls onChargeSubmitted with the subscription id on a successful charge", async () => {
    const due = fakeDueSubscription();
    const onChargeSubmitted = vi.fn(async () => {});
    const onChargeFailed = vi.fn(async () => {});

    const handle = await startKeeper({
      connection: fakeConnection(),
      keeper: Keypair.generate(),
      subscriptionManagerProgramId: Keypair.generate().publicKey,
      dueSubscriptions: async () => [due],
      onChargeSubmitted,
      onChargeFailed,
    });

    const charged = await handle.tick();

    expect(charged).toBe(1);
    expect(onChargeSubmitted).toHaveBeenCalledWith(42n);
    expect(onChargeFailed).not.toHaveBeenCalled();

    await handle.stop();
  });

  it("calls onChargeFailed with the subscription id and error message when the send fails", async () => {
    const due = fakeDueSubscription();
    const onChargeSubmitted = vi.fn(async () => {});
    const onChargeFailed = vi.fn(async () => {});

    const handle = await startKeeper({
      connection: fakeConnection({ sendShouldThrow: true }),
      keeper: Keypair.generate(),
      subscriptionManagerProgramId: Keypair.generate().publicKey,
      dueSubscriptions: async () => [due],
      onChargeSubmitted,
      onChargeFailed,
    });

    const charged = await handle.tick();

    expect(charged).toBe(0);
    expect(onChargeSubmitted).not.toHaveBeenCalled();
    expect(onChargeFailed).toHaveBeenCalledWith(42n, expect.stringContaining("simulated send failure"));

    await handle.stop();
  });

  it("stays in skeleton mode (returns 0, calls neither callback) when keeper/programId/dueSubscriptions are missing", async () => {
    const onChargeSubmitted = vi.fn(async () => {});
    const onChargeFailed = vi.fn(async () => {});

    const handle = await startKeeper({
      connection: fakeConnection(),
      onChargeSubmitted,
      onChargeFailed,
    });

    const charged = await handle.tick();

    expect(charged).toBe(0);
    expect(onChargeSubmitted).not.toHaveBeenCalled();
    expect(onChargeFailed).not.toHaveBeenCalled();

    await handle.stop();
  });
});
