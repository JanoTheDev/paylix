// No 'use client' directive — this file is imported by server components
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
} from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { getAllNetworks } from "@paylix/config/networks";

/**
 * Reown/WalletConnect project id.
 *
 * There is deliberately NO fallback. The literal that used to sit here
 * ("public fallback for localhost testing") is a live credential belonging to
 * one specific Reown account: every self-hoster who didn't set the variable
 * silently routed their users' WalletConnect relay traffic through it,
 * burning that account's quota and exposing its usage analytics (REPO-18).
 * A missing id must be an obvious failure that names the variable, not a
 * silent fallback onto someone else's account.
 *
 * Note this is a `NEXT_PUBLIC_` variable: Next.js inlines it into the client
 * bundle at BUILD time, so it has to be present when `next build` runs, not
 * merely at runtime. That is why this throws at module load — the same shape
 * as the empty-networks guard below.
 */
const PLACEHOLDER_PROJECT_IDS = new Set([
  "your_walletconnect_project_id",
  "your_project_id",
  "placeholder",
]);

// Published in this repo's history; treat as burned even if it is re-supplied
// via env. Warn rather than throw — only the owner can decide to rotate it.
const BURNED_PROJECT_ID = "b56e18d47c72ab683b10814fe9495694";

function requireProjectId(): string {
  // Direct literal reference — Next only inlines NEXT_PUBLIC_* into the client
  // bundle for static `process.env.X` lookups, never `process.env[name]`.
  const raw = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

  if (!raw || PLACEHOLDER_PROJECT_IDS.has(raw.toLowerCase())) {
    throw new Error(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required. " +
        "Create a free project at https://dashboard.reown.com and set the id " +
        "in your environment before building. It must be set at build time — " +
        "NEXT_PUBLIC_* values are inlined into the client bundle by Next.js.",
    );
  }

  if (raw === BURNED_PROJECT_ID) {
    console.error(
      "[wagmi] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set to the project id " +
        "that was previously hardcoded in this repo. It is public — rotate it " +
        "at https://dashboard.reown.com and use your own.",
    );
  }

  return raw;
}

export const projectId = requireProjectId();

/**
 * Map chainId → AppKit chain object. Every chain registered in
 * packages/config/src/network-registry.ts must have a corresponding entry
 * here, otherwise the wallet won't be able to switch to it.
 */
const APPKIT_CHAINS: Record<number, AppKitNetwork> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
  [arbitrum.id]: arbitrum,
  [arbitrumSepolia.id]: arbitrumSepolia,
  [optimism.id]: optimism,
  [optimismSepolia.id]: optimismSepolia,
  [polygon.id]: polygon,
  [polygonAmoy.id]: polygonAmoy,
  [bsc.id]: bsc,
  [bscTestnet.id]: bscTestnet,
  [avalanche.id]: avalanche,
  [avalancheFuji.id]: avalancheFuji,
};

const allNetworks = getAllNetworks();
const appKitNetworks = allNetworks
  .map((n) => APPKIT_CHAINS[n.chainId])
  .filter((c): c is AppKitNetwork => c !== undefined);

if (appKitNetworks.length === 0) {
  throw new Error(
    "No AppKit-supported networks registered. " +
      "Check packages/config/src/networks.ts and the APPKIT_CHAINS map above.",
  );
}

export const networks = appKitNetworks as [AppKitNetwork, ...AppKitNetwork[]];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
});

export const metadata = {
  name: "Paylix Checkout",
  description: "Accept USDC payments on Base",
  url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  icons: [(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000") + "/favicon.ico"],
};
