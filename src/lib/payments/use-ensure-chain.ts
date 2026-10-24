"use client";

import { useCallback, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import type { ChainId } from "@/lib/economy/networks";

/**
 * Moves the connected wallet to the chosen asset's chain. No-op when disconnected or already there. A rejected or
 * failed switch leaves `failedFor` set to that chain so the form can explain it and offer a retry. The promise resolves
 * true when the wallet is (or was already) on that chain and false when the switch failed or no wallet is connected; a
 * call that wagmi supersedes, or whose component unmounts first, may never resolve, so callers must not wait on it to
 * clean up.
 */
export function useEnsureChain(): { ensure(chainId: ChainId): Promise<boolean>; switching: boolean; failedFor: ChainId | null } {
  const { isConnected, chainId: current } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const [failedFor, setFailedFor] = useState<ChainId | null>(null);
  const ensure = useCallback(
    (chainId: ChainId) => {
      if (!isConnected || current === chainId) {
        setFailedFor(null);
        return Promise.resolve(isConnected);
      }
      return new Promise<boolean>((resolve) => {
        switchChain(
          { chainId },
          {
            onSuccess: () => {
              setFailedFor(null);
              resolve(true);
            },
            onError: () => {
              setFailedFor(chainId);
              resolve(false);
            },
          },
        );
      });
    },
    [isConnected, current, switchChain],
  );
  return { ensure, switching: isPending, failedFor };
}
