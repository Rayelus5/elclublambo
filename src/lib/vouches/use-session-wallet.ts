"use client";

import { useSyncExternalStore } from "react";
import { useAccount } from "wagmi";

const noSubscribe = () => () => {};

/**
 * Whether the connected wallet is the session's (the only one whose vouches the server accepts). `matches` gates signing;
 * `mismatch` is when to warn: another account, or none at all, once wagmi has finished (re)connecting. The server render
 * and the hydration pass count as still settling (no match, no warning): wagmi's state there is not the browser's, and a
 * different `disabled` or warning would be a hydration mismatch.
 */
export function useSessionWalletMatch(sessionWallet: string): { matches: boolean; mismatch: boolean } {
  const { address, isConnected, status } = useAccount();
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!hydrated) return { matches: false, mismatch: false };
  const matches = isConnected && !!address && address.toLowerCase() === sessionWallet.toLowerCase();
  const settling = status === "connecting" || status === "reconnecting";
  return { matches, mismatch: !matches && !settling };
}
