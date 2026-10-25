"use client";

import { useSyncExternalStore } from "react";
import { useAccount } from "wagmi";

const noSubscribe = () => () => {};

export type WalletMatch = { address: `0x${string}` | undefined; matches: boolean; mismatch: boolean };

/**
 * Whether the connected wallet is the expected one (any connected wallet when `expected` is null). `matches` gates
 * signing; `mismatch` is when to warn: another account, or none at all, once wagmi has finished (re)connecting. The
 * server render and the hydration pass count as still settling (no address, no match, no warning): wagmi's state there
 * is not the browser's, and a different `disabled` or warning would be a hydration mismatch.
 */
export function useWalletMatch(expected: string | null): WalletMatch {
  const { address, isConnected, status } = useAccount();
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!hydrated) return { address: undefined, matches: false, mismatch: false };
  const connected = isConnected && !!address;
  const matches = connected && (expected === null || address.toLowerCase() === expected.toLowerCase());
  const settling = status === "connecting" || status === "reconnecting";
  return { address: connected ? address : undefined, matches, mismatch: !matches && !settling };
}
