import "server-only";
import { chainsForSet, networkSet } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";

/** The wallet's transaction count summed over the enabled networks of this build. Throws when any RPC fails (fail closed). */
export async function countTransactions(wallet: `0x${string}`): Promise<number> {
  const counts = await Promise.all(
    chainsForSet(networkSet()).map((chain) => chainClient(chain).getTransactionCount({ address: wallet, blockTag: "latest" })),
  );
  return counts.reduce((sum, n) => sum + n, 0);
}
