import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { WebDeployment } from "./deployment";

const mockUsdcAbi = parseAbi([
  "function mint(address to, uint256 amount) external",
]);

export interface MintResult {
  txHash: `0x${string}`;
  blockNumber: bigint;
}

export async function mintMockUsdc(
  deployment: WebDeployment,
  toAddress: `0x${string}`,
  amountWei: bigint,
): Promise<MintResult> {
  const key = process.env.MOCK_USDC_MINTER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) {
    throw new Error("MOCK_USDC_MINTER_PRIVATE_KEY is not configured");
  }

  const account = privateKeyToAccount(key);
  const walletClient = createWalletClient({
    account,
    chain: deployment.chain,
    transport: http(deployment.rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: deployment.chain,
    transport: http(deployment.rpcUrl),
  });

  const txHash = await walletClient.writeContract({
    address: deployment.usdcAddress,
    abi: mockUsdcAbi,
    functionName: "mint",
    args: [toAddress, amountWei],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`MockUSDC mint reverted: ${txHash}`);
  }

  return { txHash, blockNumber: receipt.blockNumber };
}
