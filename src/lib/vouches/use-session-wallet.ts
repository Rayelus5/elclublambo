"use client";

import { useAccount } from "wagmi";

/**
 * Whether the connected wallet is the session's (the only one whose vouches the server accepts). `matches` gates signing;
 * `mismatch` is when to warn: another account, or none at all, once wagmi has finished (re)connecting.
 */
export function useSessionWalletMatch(sessionWallet: string): { matches: boolean; mismatch: boolean } {
  const { address, isConnected, status } = useAccount();
  const matches = isConnected && !!address && address.toLowerCase() === sessionWallet.toLowerCase();
  const settling = status === "connecting" || status === "reconnecting";
  return { matches, mismatch: !matches && !settling };
}
