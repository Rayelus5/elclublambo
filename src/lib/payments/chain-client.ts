import "server-only";
import { createPublicClient, http, type PublicClient } from "viem";
import { linea, lineaSepolia } from "viem/chains";
import type { ChainId } from "@/lib/economy/networks";

/** Read-only client per chain. `LINEA_RPC_URL` / `LINEA_SEPOLIA_RPC_URL` override the public RPCs. */
export function chainClient(chain: ChainId): PublicClient {
  const mainnet = chain === 59144;
  const url = (mainnet ? process.env.LINEA_RPC_URL : process.env.LINEA_SEPOLIA_RPC_URL) || undefined;
  return createPublicClient({
    chain: mainnet ? linea : lineaSepolia,
    transport: http(url, { timeout: 8000, retryCount: 1 }),
  }) as PublicClient;
}
