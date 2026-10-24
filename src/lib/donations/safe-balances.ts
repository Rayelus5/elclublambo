import "server-only";
import { erc20Abi } from "viem";
import { appChainIds, NETWORKS, type ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";

/** Base units; null when the read failed or the network has no Safe stored. */
export type SafeBalance = { chainId: ChainId; usdc: bigint | null; eth: bigint | null };

async function read(label: string, chain: ChainId, run: () => Promise<bigint>): Promise<bigint | null> {
  try {
    return await run();
  } catch (e) {
    console.error(`[donations] safe ${label} read failed`, chain, safeError(e));
    return null;
  }
}

/** The club Safe's USDC and ETH on every network of the build, read on-chain (one failed read never hides the others). */
export async function getSafeBalances(): Promise<SafeBalance[]> {
  const chains = appChainIds();
  const { data, error } = await createAdminClient().from("chains").select("chain_id, safe_address").in("chain_id", chains);
  if (error) console.error("[donations] chains read failed", safeError(error.message));
  const safes = new Map<number, string>();
  for (const r of (data ?? []) as { chain_id: number; safe_address: string | null }[]) if (r.safe_address) safes.set(r.chain_id, r.safe_address);

  return Promise.all(
    chains.map(async (chainId): Promise<SafeBalance> => {
      const safe = safes.get(chainId) as `0x${string}` | undefined;
      if (!safe) return { chainId, usdc: null, eth: null };
      const client = chainClient(chainId);
      const [usdc, eth] = await Promise.all([
        read("usdc", chainId, () => client.readContract({ address: NETWORKS[chainId].usdc, abi: erc20Abi, functionName: "balanceOf", args: [safe] })),
        read("eth", chainId, () => client.getBalance({ address: safe })),
      ]);
      return { chainId, usdc, eth };
    }),
  );
}
