"use client";

import { useWalletMatch } from "@/lib/web3/use-wallet-match";

/**
 * P5's name for `useWalletMatch(sessionWallet)`: whether the connected wallet is the session's (the only one whose
 * vouches the server accepts). Same hydration-safe states; it keeps P5's `{ matches, mismatch }` shape.
 */
export function useSessionWalletMatch(sessionWallet: string): { matches: boolean; mismatch: boolean } {
  const { matches, mismatch } = useWalletMatch(sessionWallet);
  return { matches, mismatch };
}
