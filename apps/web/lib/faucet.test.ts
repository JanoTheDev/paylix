import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mintMockUsdc } from "./faucet";

const writeContractMock = vi.fn();
const waitForTransactionReceiptMock = vi.fn();

vi.mock("viem", async (importActual) => {
  const actual = await importActual<typeof import("viem")>();
  return {
    ...actual,
    createWalletClient: vi.fn(() => ({
      writeContract: writeContractMock,
    })),
    createPublicClient: vi.fn(() => ({
      waitForTransactionReceipt: waitForTransactionReceiptMock,
    })),
    http: vi.fn(),
  };
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({ address: "0xabcabcabcabcabcabcabcabcabcabcabcabcabca" as `0x${string}` })),
}));

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  writeContractMock.mockReset();
  waitForTransactionReceiptMock.mockReset();
});

afterEach(() => {
  process.env = originalEnv;
});

const fakeDeployment = {
  network: { key: "base-sepolia" },
  chain: { id: 84532, name: "Base Sepolia" },
  chainId: 84532,
  rpcUrl: "https://test.example",
  paymentVault: "0x0000000000000000000000000000000000000001",
  subscriptionManager: "0x0000000000000000000000000000000000000002",
  usdcAddress: "0x0000000000000000000000000000000000000003",
} as const;

describe("mintMockUsdc", () => {
  it("returns a tx hash after a successful mint", async () => {
    process.env.MOCK_USDC_MINTER_PRIVATE_KEY = "0x" + "a".repeat(64);
    writeContractMock.mockResolvedValue("0xdeadbeef" as `0x${string}`);
    waitForTransactionReceiptMock.mockResolvedValue({
      status: "success",
      blockNumber: 12345n,
      transactionHash: "0xdeadbeef",
    });

    const result = await mintMockUsdc(
      fakeDeployment as never,
      "0x1111111111111111111111111111111111111111",
      1_000_000_000n,
    );

    expect(result.txHash).toBe("0xdeadbeef");
    expect(result.blockNumber).toBe(12345n);
  });

  it("throws when minter key is not configured", async () => {
    delete process.env.MOCK_USDC_MINTER_PRIVATE_KEY;
    await expect(
      mintMockUsdc(
        fakeDeployment as never,
        "0x1111111111111111111111111111111111111111",
        1_000_000_000n,
      ),
    ).rejects.toThrow(/MOCK_USDC_MINTER_PRIVATE_KEY/);
  });

  it("throws when the mint transaction reverts", async () => {
    process.env.MOCK_USDC_MINTER_PRIVATE_KEY = "0x" + "a".repeat(64);
    writeContractMock.mockResolvedValue("0xrevertedtx" as `0x${string}`);
    waitForTransactionReceiptMock.mockResolvedValue({
      status: "reverted",
      blockNumber: 12346n,
      transactionHash: "0xrevertedtx",
    });

    await expect(
      mintMockUsdc(
        fakeDeployment as never,
        "0x1111111111111111111111111111111111111111",
        1_000_000_000n,
      ),
    ).rejects.toThrow(/reverted/);
  });
});
