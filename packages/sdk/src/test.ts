import { request } from "./request";
import type { PaylixConfig } from "./types";

export interface FaucetParams {
  /** Address to mint mock USDC to. */
  address: string;
  /** Integer cents. Defaults to the deployment's per-request cap. */
  amount?: number;
}

export interface FaucetResult {
  success: true;
  txHash: string;
  /** Integer cents actually minted. */
  amountMinted: number;
}

/**
 * Mints mock USDC on a testnet deployment. Rejected with 400 outside test
 * mode — there is no mainnet equivalent.
 */
export async function faucet(
  config: PaylixConfig,
  req: FaucetParams,
): Promise<FaucetResult> {
  return request<FaucetResult>(config, "POST", "/api/test/faucet", {
    body: req,
  });
}
