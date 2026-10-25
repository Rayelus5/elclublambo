"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import type { ChainId } from "@/lib/economy/networks";

type Address = `0x${string}`;
export type WalletIdle = "idle" | "pending" | "unknown" | "checking";

/**
 * R1: whether `address` has transactions not mined yet on the chain (pending nonce above latest). A line may only be
 * ticked or released when it has none: a pending tx could still be the line's transfer, mined late. Throws when a
 * nonce cannot be read; callers treat that as not idle.
 */
export async function readWalletIdle(client: Pick<PublicClient, "getTransactionCount">, address: Address): Promise<"idle" | "pending"> {
  const [pending, latest] = await Promise.all([
    client.getTransactionCount({ address, blockTag: "pending" }),
    client.getTransactionCount({ address, blockTag: "latest" }),
  ]);
  return pending > latest ? "pending" : "idle";
}

/** R1 in the form, refreshed every 15 s while `enabled`: «idle» only after a successful read. */
export function useWalletIdle(chain: ChainId, address: Address | undefined, enabled: boolean): WalletIdle {
  const config = useConfig();
  const q = useQuery({
    queryKey: ["multisendWalletIdle", chain, address],
    queryFn: () => readWalletIdle(getPublicClient(config, { chainId: chain }) as Pick<PublicClient, "getTransactionCount">, address!),
    enabled: enabled && !!address,
    refetchInterval: 15_000,
    retry: false,
  });
  if (q.isError) return "unknown";
  return q.data ?? "checking";
}
