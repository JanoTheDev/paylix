import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NetworkKey } from "@paylix/config/networks";

// Mock the db before importing the function under test
vi.mock("@/lib/db", () => {
  return {
    db: {
      query: {
        merchantPayoutWallets: { findFirst: vi.fn() },
      },
      select: vi.fn(),
    },
  };
});

import { resolvePayoutWallet } from "../payout-wallets";
import { db } from "@/lib/db";

const user = "test-user-id";
const network: NetworkKey = "base-sepolia";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvePayoutWallet", () => {
  it("throws when no row exists for the (user, network)", async () => {
    (db.query.merchantPayoutWallets.findFirst as any).mockResolvedValue(null);
    await expect(resolvePayoutWallet(user, network)).rejects.toThrow(
      /not enabled/,
    );
  });

  it("returns the override address when set", async () => {
    (db.query.merchantPayoutWallets.findFirst as any).mockResolvedValue({
      walletAddress: "0xOverrideAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    const result = await resolvePayoutWallet(user, network);
    expect(result).toBe("0xOverrideAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("falls back to users.walletAddress when row has NULL override", async () => {
    (db.query.merchantPayoutWallets.findFirst as any).mockResolvedValue({
      walletAddress: null,
    });
    (db.select as any).mockReturnValue({
      from: () => ({
        where: () =>
          Promise.resolve([
            { walletAddress: "0xDefaultBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" },
          ]),
      }),
    });
    const result = await resolvePayoutWallet(user, network);
    expect(result).toBe("0xDefaultBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
  });

  it("throws when default wallet is also missing", async () => {
    (db.query.merchantPayoutWallets.findFirst as any).mockResolvedValue({
      walletAddress: null,
    });
    (db.select as any).mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([{ walletAddress: null }]),
      }),
    });
    await expect(resolvePayoutWallet(user, network)).rejects.toThrow(
      /No payout wallet/,
    );
  });
});
