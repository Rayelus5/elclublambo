import "server-only";
import { createPublicClient, http, type PublicClient } from "viem";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";

/** Read-only client per chain. The network's server RPC env var (e.g. `BASE_SEPOLIA_RPC_URL`) overrides its public RPC. */
export function chainClient(chain: ChainId, env: Record<string, string | undefined> = process.env): PublicClient {
  const net = NETWORKS[chain];
  return createPublicClient({
    chain: net.viemChain,
    transport: http(env[net.serverRpcEnv] || undefined, { timeout: 8000, retryCount: 1 }),
  }) as PublicClient;
}
