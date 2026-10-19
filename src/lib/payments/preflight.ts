"use client";

import { useCallback } from "react";
import { erc20Abi } from "viem";
import { getBalance, readContract } from "wagmi/actions";
import { useBalance, useConfig, useReadContract } from "wagmi";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { formatAmount, type Token } from "@/lib/payments/amounts";

export type PreflightInput = {
  chain: ChainId;
  token: Token;
  /** Fee still to be signed (ignored when `feePaid`). */
  feeAmount: bigint;
  mainAmount: bigint;
  /** Resume: the fee transfer is already mined, only the main amount is left. */
  feePaid: boolean;
  /** Lowercase noun for the main transfer: "donación", "propina", "pago". */
  mainLabel: string;
  eth: bigint;
  usdc: bigint;
};

/**
 * Pure check of the paying wallet's balances against what is still to be signed. Returns the Spanish message for the
 * member when short, null when fine. A wallet that cannot pay the main amount after sending the fee ends up with the
 * fee gone and a main transfer that reverts (the wallet then shows an absurd gas estimate), so this runs before the
 * first signature.
 */
export function preflightShortfall(i: PreflightInput): string | null {
  const net = NETWORKS[i.chain].name;
  const remaining = i.feePaid ? i.mainAmount : i.mainAmount + i.feeAmount;
  const have = i.token === "USDC" ? i.usdc : i.eth;
  // ETH: the amounts must be strictly covered so some ETH is left for gas; USDC: the amounts must be covered.
  const short = i.token === "USDC" ? have < remaining : have <= remaining;
  if (short) {
    const need = `${formatAmount(remaining, i.token)} ${i.token}`;
    const has = formatAmount(have, i.token);
    if (i.feePaid) {
      return `No tienes suficiente ${i.token} en ${net}: necesitas ${need} para la ${i.mainLabel} y tienes ${has}. La comisión ya está pagada: añade saldo y pulsa Firmar para continuar.`;
    }
    return `No tienes suficiente ${i.token} en ${net}: necesitas ${need}${i.feeAmount > 0n ? ` (${i.mainLabel} + comisión)` : ""} y tienes ${has}. No se ha enviado nada.`;
  }
  if (i.token === "USDC" && i.eth <= 0n) return `Necesitas algo de ETH en ${net} para pagar el gas.`;
  return null;
}

/**
 * Inline check while the member types (no intent exists yet): the balance of the chosen token must cover amount + fee,
 * and for USDC there must be ETH for gas. Same rules as `preflightShortfall`, worded for the form.
 */
export function formBalanceError(i: { chain: ChainId; token: Token; amount: bigint; fee: bigint; balance: bigint; eth: bigint }): string | null {
  const need = i.amount + i.fee;
  const short = i.token === "USDC" ? i.balance < need : i.balance <= need;
  if (short) {
    return `Saldo insuficiente: necesitas ${formatAmount(need, i.token)} ${i.token}${i.fee > 0n ? " (importe + comisión)" : ""} y tienes ${formatAmount(i.balance, i.token)}.`;
  }
  if (i.token === "USDC" && i.eth <= 0n) return `Necesitas algo de ETH en ${NETWORKS[i.chain].name} para el gas.`;
  return null;
}

/** The same check with a live read of the balances; a failed read never blocks (the wallet still protects). */
export function useBalancePreflight(): (a: Omit<PreflightInput, "eth" | "usdc"> & { account: `0x${string}` }) => Promise<string | null> {
  const config = useConfig();
  return useCallback(
    async ({ account, ...a }) => {
      try {
        const [eth, usdc] = await Promise.all([
          getBalance(config, { address: account, chainId: a.chain }),
          readContract(config, { address: NETWORKS[a.chain].usdc, abi: erc20Abi, functionName: "balanceOf", args: [account], chainId: a.chain }),
        ]);
        return preflightShortfall({ ...a, eth: eth.value, usdc });
      } catch {
        return null;
      }
    },
    [config],
  );
}

/** Live balances for the form; null when not readable (or no account). Re-read on mount and when account/chain change. */
export function useWalletBalances(chain: ChainId, account: `0x${string}` | undefined): { eth: bigint | null; usdc: bigint | null } {
  const enabled = !!account;
  const eth = useBalance({ address: account, chainId: chain, query: { enabled } });
  const usdc = useReadContract({
    address: NETWORKS[chain].usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId: chain,
    query: { enabled },
  });
  return {
    eth: eth.data?.value ?? null,
    usdc: typeof usdc.data === "bigint" ? usdc.data : null,
  };
}
