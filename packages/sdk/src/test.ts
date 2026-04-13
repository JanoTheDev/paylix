import type { PaylixConfig } from "./types";

export async function faucet(
  config: PaylixConfig,
  req: { address: string; amount?: number }
): Promise<{ success: true; txHash: string; amountMinted: number }> {
  const response = await fetch(`${config.backendUrl}/api/test/faucet`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({ error: "Request failed" }))) as { error?: string };
    throw new Error(`Paylix faucet failed: ${error.error || response.statusText}`);
  }

  return (await response.json()) as { success: true; txHash: string; amountMinted: number };
}
