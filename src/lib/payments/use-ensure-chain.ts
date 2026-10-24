"use client";

import { useCallback, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import type { ChainId } from "@/lib/economy/networks";

/**
 * Moves the connected wallet to the chosen asset's chain. No-op when disconnected or already there. A rejected or
 * failed switch leaves `failedFor` set to that chain so the form can explain it and offer a retry.
 */
export function useEnsureChain(): { ensure(chainId: ChainId): void; switching: boolean; failedFor: ChainId | null } {
  const { isConnected, chainId: current } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const [failedFor, setFailedFor] = useState<ChainId | null>(null);
  const ensure = useCallback(
    (chainId: ChainId) => {
      if (!isConnected || current === chainId) {
        setFailedFor(null);
        return;
      }
      switchChain({ chainId }, { onSuccess: () => setFailedFor(null), onError: () => setFailedFor(chainId) });
    },
    [isConnected, current, switchChain],
  );
  return { ensure, switching: isPending, failedFor };
}
