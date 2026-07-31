import { NETWORKS } from "@paylix/config/networks";

/**
 * Builds a block-explorer URL for a specific network.
 *
 * The platform is multi-chain (`NETWORKS` in @paylix/config), so a tx hash or
 * address is only meaningful alongside the network it lives on. Callers that
 * carry a `networkKey` on the row MUST pass it — otherwise the link resolves
 * on whatever explorer the deployment defaults to, which 404s on every other
 * chain.
 *
 * Returns `null` when the key is missing or not an EVM network in the registry
 * (Solana/Bitcoin/Litecoin are not registered here), so the caller can decide
 * on a fallback.
 */
export function networkExplorerUrl(
  kind: "tx" | "address",
  value: string,
  networkKey: string | undefined,
): string | null {
  if (!networkKey) return null;
  const network = NETWORKS[networkKey as keyof typeof NETWORKS];
  if (!network?.blockExplorer) return null;
  return `${network.blockExplorer.replace(/\/+$/, "")}/${kind}/${value}`;
}
