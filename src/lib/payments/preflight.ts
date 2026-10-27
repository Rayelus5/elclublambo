"use client";

import { useCallback } from "react";
import { useConfig } from "wagmi";
import { assetsFor } from "@/lib/economy/assets";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { formatAmount, type Token } from "@/lib/payments/amounts";
import { readAssetBalance } from "@/lib/payments/balances";

export type PreflightInput = {
  chain: ChainId;
  token: Token;
  amount: bigint;
  /** What is being paid, with its article: "la propina", "el pago". */
  mainLabel: string;
  eth: bigint;
  usdc: bigint;
};

/**
 * Pure check of the paying wallet's balances on the payment's chain, right before the signature. Returns the Spanish
 * message for the member when short, null when fine. ETH must exceed the amount (the rest pays gas); USDC must cover
 * the amount and the chain must hold some ETH for gas.
 */
export function preflightShortfall(i: PreflightInput): string | null {
  const net = NETWORKS[i.chain].name;
  const have = i.token === "USDC" ? i.usdc : i.eth;
  const short = i.token === "USDC" ? have < i.amount : have <= i.amount;
  if (short) {
    return `No tienes suficiente ${i.token} en ${net} para ${i.mainLabel}: necesitas ${formatAmount(i.amount, i.token)} ${i.token} y tienes ${formatAmount(have, i.token)}. No se ha enviado nada.`;
  }
  if (i.token === "USDC" && i.eth <= 0n) return `Necesitas algo de ETH en ${net} para pagar el gas.`;
  return null;
}

/** Inline check while the member types (no intent exists yet). Same rules as `preflightShortfall`, worded for the form. */
export function formBalanceError(i: { chain: ChainId; token: Token; amount: bigint; balance: bigint; eth: bigint }): string | null {
  const short = i.token === "USDC" ? i.balance < i.amount : i.balance <= i.amount;
  if (short) return `Saldo insuficiente: necesitas ${formatAmount(i.amount, i.token)} ${i.token} y tienes ${formatAmount(i.balance, i.token)}.`;
  if (i.token === "USDC" && i.eth <= 0n) return `Necesitas algo de ETH en ${NETWORKS[i.chain].name} para el gas.`;
  return null;
}

/** The same check with a live read of the balances on the payment's chain; a failed read never blocks (the wallet still protects). */
export function useBalancePreflight(): (a: Omit<PreflightInput, "eth" | "usdc"> & { account: `0x${string}` }) => Promise<string | null> {
  const config = useConfig();
  return useCallback(
    async ({ account, ...a }) => {
      try {
        const chainAssets = assetsFor([a.chain]);
        const eth = chainAssets.find((x) => x.token === "ETH")!;
        const usdc = chainAssets.find((x) => x.token === "USDC")!;
        const [ethBal, usdcBal] = await Promise.all([
          readAssetBalance(config, eth, account),
          a.token === "USDC" ? readAssetBalance(config, usdc, account) : Promise.resolve(0n),
        ]);
        return preflightShortfall({ ...a, eth: ethBal, usdc: usdcBal });
      } catch {
        return null;
      }
    },
    [config],
  );
}
