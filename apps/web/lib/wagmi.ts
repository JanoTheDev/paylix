// No 'use client' directive — this file is imported by server components
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { base, baseSepolia } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";

export const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
  "b56e18d47c72ab683b10814fe9495694"; // public fallback for localhost testing

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [baseSepolia, base];

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
