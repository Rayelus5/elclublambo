"use client";

import { useCallback, useMemo } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { erc20Abi } from "viem";
import { getBalance, readContract } from "wagmi/actions";
import { useConfig, type Config } from "wagmi";
import { assetsFor, type Asset, type AssetBalances } from "@/lib/economy/assets";

/** One asset's balance in base units on its own chain (native ETH or the chain's USDC `balanceOf`). */
export async function readAssetBalance(config: Config, asset: Asset, account: `0x${string}`): Promise<bigint> {
  if (asset.contract === null) return (await getBalance(config, { address: account, chainId: asset.chainId })).value;
  return readContract(config, {
    address: asset.contract,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
    chainId: asset.chainId,
  });
}

/** The assets plus the ETH of every chain present (rankAssets needs it for USDC gas), without duplicates. */
function withGas(assets: readonly Asset[]): Asset[] {
  const out = new Map(assets.map((a) => [a.id, a]));
  const chains = [...new Set(assets.map((a) => a.chainId))];
  for (const eth of assetsFor(chains).filter((a) => a.token === "ETH")) if (!out.has(eth.id)) out.set(eth.id, eth);
  return [...out.values()];
}

export const BALANCE_STALE_MS = 20_000;

/**
 * Live balances of the account for each asset, each read on its own chain (not the wallet's current one). Null while
 * loading, when the read fails or without an account: unknown never blocks, the wallet still protects. Reads stay
 * fresh for BALANCE_STALE_MS so reopening a picker does not hit every RPC again; a payment invalidates them at once.
 */
export function useAssetBalances(assets: readonly Asset[], account: `0x${string}` | undefined): AssetBalances {
  const config = useConfig();
  const all = useMemo(() => withGas(assets), [assets]);
  const results = useQueries({
    queries: all.map((a) => ({
      queryKey: ["assetBalance", a.id, account] as const,
      queryFn: () => readAssetBalance(config, a, account!),
      enabled: !!account,
      staleTime: BALANCE_STALE_MS,
    })),
  });
  return Object.fromEntries(all.map((a, i) => [a.id, results[i]?.data ?? null])) as AssetBalances;
}

/** After a payment: every cached asset balance is stale, so the next picker shows what the wallet holds now. */
export function useInvalidateAssetBalances(): () => void {
  const client = useQueryClient();
  return useCallback(() => void client.invalidateQueries({ queryKey: ["assetBalance"] }), [client]);
}
