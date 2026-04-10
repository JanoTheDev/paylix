import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, baseSepolia } from "wagmi/chains";
import type { Config } from "wagmi";

export const wagmiConfig: Config = getDefaultConfig({
  appName: "Paylix Checkout",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo",
  chains: [base, baseSepolia],
  ssr: true,
});
