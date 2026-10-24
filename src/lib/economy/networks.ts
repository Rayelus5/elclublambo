import type { Chain } from "viem";
import { arbitrum, arbitrumSepolia, base, baseSepolia } from "viem/chains";

export type ChainId = 8453 | 42161 | 84532 | 421614;
export type NetworkKey = "base" | "arbitrum";
/** The build's chains: PRO uses mainnet, PRE / local / e2e use testnet (NEXT_PUBLIC_NETWORK_SET, P0-R1). */
export type NetworkSet = "mainnet" | "testnet";

export type Network = {
  id: ChainId;
  key: NetworkKey;
  name: string;
  testnet: boolean;
  /** Circle's native USDC (6 decimals). No USDC.e (D3). */
  usdc: `0x${string}`;
  explorer: string;
  viemChain: Chain;
  /** Server-side RPC override; empty means the chain's public RPC. */
  serverRpcEnv: "BASE_RPC_URL" | "ARBITRUM_RPC_URL" | "BASE_SEPOLIA_RPC_URL" | "ARBITRUM_SEPOLIA_RPC_URL";
  logo: string;
  /** Tip confirmations (P0-R9) and the Safe scan's chunking (consumed in P1). */
  finality: { tipConfirmations: number; scanChunkBlocks: number; maxScanChunks: number };
};

const BASE_FINALITY = { tipConfirmations: 3, scanChunkBlocks: 2000, maxScanChunks: 10 };
const ARBITRUM_FINALITY = { tipConfirmations: 20, scanChunkBlocks: 2000, maxScanChunks: 40 };

/**
 * USDC: Circle's docs (developers.circle.com/stablecoins/usdc-contract-addresses), re-checked 2026-10-24, with
 * on-chain decimals() = 6 on each chain the same day. Explorers: web links only (P0-R10).
 */
export const NETWORKS: Record<ChainId, Network> = {
  8453: {
    id: 8453,
    key: "base",
    name: "Base",
    testnet: false,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    explorer: "https://basescan.org",
    viemChain: base,
    serverRpcEnv: "BASE_RPC_URL",
    logo: "/brand/networks/base.svg",
    finality: BASE_FINALITY,
  },
  42161: {
    id: 42161,
    key: "arbitrum",
    name: "Arbitrum",
    testnet: false,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    explorer: "https://arbiscan.io",
    viemChain: arbitrum,
    serverRpcEnv: "ARBITRUM_RPC_URL",
    logo: "/brand/networks/arbitrum.svg",
    finality: ARBITRUM_FINALITY,
  },
  84532: {
    id: 84532,
    key: "base",
    name: "Base Sepolia",
    testnet: true,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorer: "https://sepolia.basescan.org",
    viemChain: baseSepolia,
    serverRpcEnv: "BASE_SEPOLIA_RPC_URL",
    logo: "/brand/networks/base.svg",
    finality: BASE_FINALITY,
  },
  421614: {
    id: 421614,
    key: "arbitrum",
    name: "Arbitrum Sepolia",
    testnet: true,
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    explorer: "https://sepolia.arbiscan.io",
    viemChain: arbitrumSepolia,
    serverRpcEnv: "ARBITRUM_SEPOLIA_RPC_URL",
    logo: "/brand/networks/arbitrum.svg",
    finality: ARBITRUM_FINALITY,
  },
};

export const CHAIN_IDS: readonly ChainId[] = [8453, 42161, 84532, 421614];

export function isChainId(n: unknown): n is ChainId {
  return typeof n === "number" && (CHAIN_IDS as readonly number[]).includes(n);
}

export function chainsForSet(set: NetworkSet): ChainId[] {
  return CHAIN_IDS.filter((c) => NETWORKS[c].testnet === (set === "testnet"));
}

/** The build's network set. Unset or empty is testnet; anything else throws (a typo must not silently pick a set). */
export function networkSet(value: string | undefined = process.env.NEXT_PUBLIC_NETWORK_SET): NetworkSet {
  if (value === undefined || value === "") return "testnet";
  if (value === "mainnet" || value === "testnet") return value;
  throw new Error(`Unknown NEXT_PUBLIC_NETWORK_SET: ${value}`);
}

/** The chains this build uses, base first. */
export function appChainIds(): ChainId[] {
  return chainsForSet(networkSet());
}

/** The build's chain for a network key ("base" -> 8453 on mainnet, 84532 on testnet). */
export function chainForKey(key: NetworkKey): ChainId {
  const c = appChainIds().find((id) => NETWORKS[id].key === key);
  if (c === undefined) throw new Error(`No chain for network ${key}`);
  return c;
}

export function explorerTx(chain: ChainId, hash: string): string {
  return `${NETWORKS[chain].explorer}/tx/${hash}`;
}

export function explorerBlock(chain: ChainId, n: bigint): string {
  return `${NETWORKS[chain].explorer}/block/${n}`;
}

export function explorerAddress(chain: ChainId, addr: string): string {
  return `${NETWORKS[chain].explorer}/address/${addr}`;
}
