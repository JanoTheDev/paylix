"use client";

import { createAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, type Config } from "wagmi";
import { projectId, networks, wagmiAdapter, metadata } from "@/lib/wagmi";

const queryClient = new QueryClient();

// Initialize AppKit ONCE at module scope
createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata,
  features: {
    analytics: false,
    email: false,
    socials: false,
    emailShowWallets: true,
  },
});

export function Web3Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig as Config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// Backwards-compatible alias
export const CheckoutProviders = Web3Providers;
