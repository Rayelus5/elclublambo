// Browser-side read of the draw block for the public verifier: the block's hash and time, and its parent's time.
// No server-only on purpose: it runs in the visitor's browser against the network's public RPC, so the check does
// not depend on the forum's own server.
import { BlockNotFoundError, createPublicClient, http } from "viem";
import { linea, lineaSepolia } from "viem/chains";
import type { LegacyChainId } from "@/lib/legacy/linea";

export interface DrawBlocks {
  hash: string;
  /** Seconds since the epoch. */
  timestamp: bigint;
  parentTimestamp: bigint;
}

/**
 * The browser's RPC. NEXT_PUBLIC_* are public (inlined into the bundle): only for tests and local chains, empty in
 * production so the public RPC is used and the check stays independent of the forum. Never the server's
 * LINEA_*_RPC_URL, which may carry a private key. The references are literal because Next inlines them by name.
 */
function browserRpcUrl(chain: LegacyChainId): string | undefined {
  const url = chain === 59144 ? process.env.NEXT_PUBLIC_LINEA_RPC_URL : process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL;
  return url || undefined;
}

/** The draw block and its parent, null when the chain has no such block; throws when the network cannot be read. */
export async function fetchDrawBlocks(chain: LegacyChainId, blockNumber: bigint): Promise<DrawBlocks | null> {
  const client = createPublicClient({
    chain: chain === 59144 ? linea : lineaSepolia,
    transport: http(browserRpcUrl(chain), { timeout: 10000, retryCount: 1 }),
  });
  try {
    if (blockNumber <= 0n) return null;
    const [block, parent] = await Promise.all([client.getBlock({ blockNumber }), client.getBlock({ blockNumber: blockNumber - 1n })]);
    if (!block.hash) return null;
    return { hash: block.hash, timestamp: block.timestamp, parentTimestamp: parent.timestamp };
  } catch (e) {
    if (e instanceof BlockNotFoundError) return null;
    throw e;
  }
}
