"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { MaintenanceBanner } from "@/components/status/maintenance-banner";
import { wagmiAdapter } from "@/lib/web3/appkit";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <MaintenanceBanner />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
