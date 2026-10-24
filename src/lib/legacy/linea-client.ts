import "server-only";
import { createPublicClient, http, type PublicClient } from "viem";
import { linea, lineaSepolia } from "viem/chains";
import type { LegacyChainId } from "@/lib/legacy/linea";

/** Read-only client for the legacy islands (P0-R2), always on the chain's public RPC. */
export function legacyChainClient(chain: LegacyChainId): PublicClient {
  return createPublicClient({
    chain: chain === 59144 ? linea : lineaSepolia,
    transport: http(undefined, { timeout: 8000, retryCount: 1 }),
  }) as PublicClient;
}
