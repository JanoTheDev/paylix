import { createPublicClient, http, erc20Abi, type Address } from "viem";
import { NETWORKS, type NetworkKey, resolveTokenAddress } from "@paylix/config/networks";

/**
 * "Does this wallet have any on-chain history?" — one of the trial
 * anti-abuse layers (a freshly-minted wallet is a free-trial farm).
 *
 * Every failure path returns `{ active: true }` (fail open) so a flaky RPC
 * never blocks a legitimate buyer. That is a deliberate trade-off, but it
 * silently disables the control, so each fail-open branch logs a warning.
 *
 * `rpcUrl` should come from `resolveDeploymentForMode(livemode).rpcUrl`.
 * Without it viem falls back to the chain's default public RPC, which is
 * heavily rate-limited — the old code read an undeclared `RPC_URL` env var
 * that is not set anywhere in this repo, so it was always on that fallback.
 */
export async function checkWalletActivity(args: {
  address: `0x${string}`;
  networkKey: string;
  tokenSymbol: string;
  rpcUrl?: string;
}): Promise<{ active: boolean; reason?: string }> {
  const failOpen = (reason: string) => {
    console.warn(
      `[wallet-activity] fail-open (${reason}) for network=${args.networkKey} ` +
        `token=${args.tokenSymbol}; trial wallet-history check skipped`,
    );
    return { active: true };
  };

  const network = NETWORKS[args.networkKey as NetworkKey];
  if (!network) return failOpen("unknown_network");

  if (!args.rpcUrl) {
    console.warn(
      "[wallet-activity] no rpcUrl supplied; falling back to the public RPC. " +
        "Pass resolveDeploymentForMode(livemode).rpcUrl.",
    );
  }

  const client = createPublicClient({
    chain: network.viemChain,
    transport: http(args.rpcUrl),
  });

  try {
    const txCount = await client.getTransactionCount({ address: args.address });
    if (txCount > 0) return { active: true };
  } catch {
    return failOpen("tx_count_rpc_error");
  }

  const tokenConfig =
    network.tokens[args.tokenSymbol as keyof typeof network.tokens];
  if (!tokenConfig) return failOpen("unknown_token");

  let tokenAddress: `0x${string}`;
  try {
    tokenAddress = resolveTokenAddress(tokenConfig);
  } catch {
    return failOpen("token_address_unresolvable");
  }

  try {
    const balance = await client.readContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [args.address],
    });
    if (balance > 0n) return { active: true };
  } catch {
    return failOpen("balance_rpc_error");
  }

  return { active: false, reason: "no_history" };
}
