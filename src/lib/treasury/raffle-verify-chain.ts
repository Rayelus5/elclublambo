// Browser-side read of the draw block for the public verifier: the block's hash and time, and its parent's time.
// No server-only on purpose: it runs in the visitor's browser against the network's public RPC, so the check does
// not depend on the forum's own server.
import { createPublicClient, http } from "viem";
import { linea, lineaSepolia } from "viem/chains";
import type { ChainId } from "@/lib/economy/networks";

export interface DrawBlocks {
  hash: string;
  /** Seconds since the epoch. */
  timestamp: bigint;
  parentTimestamp: bigint;
}

export async function fetchDrawBlocks(chain: ChainId, blockNumber: bigint): Promise<DrawBlocks> {
  const client = createPublicClient({ chain: chain === 59144 ? linea : lineaSepolia, transport: http(undefined, { timeout: 10000, retryCount: 1 }) });
  const [block, parent] = await Promise.all([
    client.getBlock({ blockNumber }),
    blockNumber > 0n ? client.getBlock({ blockNumber: blockNumber - 1n }) : Promise.resolve(null),
  ]);
  if (!block.hash || !parent) throw new Error("block unavailable");
  return { hash: block.hash, timestamp: block.timestamp, parentTimestamp: parent.timestamp };
}
