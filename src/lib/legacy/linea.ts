// Legacy islands only (DAO, raffles, polls; P0-R2) until P1. New money flows use @/lib/economy/networks.
export type LegacyChainId = 59144 | 59141;

export type LegacyNetwork = {
  id: LegacyChainId;
  name: string;
  usdc: `0x${string}`;
  /** Canonical WETH (18 decimals); null when the chain has none. */
  weth: `0x${string}` | null;
  /** Chainlink ETH/USD proxy (8 decimals); null when there is no feed (CoinGecko fallback only). */
  ethUsdFeed: `0x${string}` | null;
  /** The feed's heartbeat in seconds; an answer older than heartbeat + 10 % is stale. */
  ethUsdHeartbeatSec: number;
  explorer: string;
  testnet: boolean;
};

/**
 * Verified addresses (fetched 2026-10-18):
 * - USDC: Circle's docs (developers.circle.com/stablecoins/usdc-contract-addresses).
 * - ETH/USD: Chainlink's feed directory behind docs.chain.link/data-feeds/price-feeds/addresses?network=linea
 *   (reference-data-directory.vercel.app/feeds-ethereum-mainnet-linea-1.json and
 *   feeds-ethereum-testnet-sepolia-linea-1.json, entry "ETH / USD"): mainnet proxy 0x3c6C…54dA, Linea Sepolia proxy
 *   0x0B55…24bc, both 8 decimals, heartbeat 86400 s, deviation 0.5 %. On-chain decimals() = 8 checked the same day.
 * - WETH: the official Linea token list linked from docs.linea.build/network/build/contracts ("Other tokens"):
 *   github.com/Consensys/linea-token-list json/linea-mainnet-token-shortlist.json (updatedAt 2026-08-29) and
 *   json/linea-sepolia-token-shortlist.json (updatedAt 2025-12-22), symbol WETH, 18 decimals. The mainnet address is
 *   also Chainlink CCIP's WETH fee token for Linea (docs.chain.link/ccip/directory/mainnet/chain/ethereum-mainnet-linea-1).
 */
export const LEGACY_NETWORKS: Record<LegacyChainId, LegacyNetwork> = {
  59144: {
    id: 59144,
    name: "Linea",
    usdc: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
    weth: "0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f",
    ethUsdFeed: "0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA",
    ethUsdHeartbeatSec: 86400,
    explorer: "https://lineascan.build",
    testnet: false,
  },
  59141: {
    id: 59141,
    name: "Linea Sepolia",
    usdc: "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7",
    weth: "0x06565ed324Ee9fb4DB0FF80B7eDbE4Cb007555a3",
    ethUsdFeed: "0x0B553921D3282250f0FB1D1EF2aA71365A7624bc",
    ethUsdHeartbeatSec: 86400,
    explorer: "https://sepolia.lineascan.build",
    testnet: true,
  },
};

export const LEGACY_CHAIN_IDS: LegacyChainId[] = [59144, 59141];

export function isLegacyChainId(n: unknown): n is LegacyChainId {
  return n === 59144 || n === 59141;
}

export function legacyExplorerTx(chain: LegacyChainId, hash: string): string {
  return `${LEGACY_NETWORKS[chain].explorer}/tx/${hash}`;
}

export function legacyExplorerBlock(chain: LegacyChainId, n: bigint): string {
  return `${LEGACY_NETWORKS[chain].explorer}/block/${n}`;
}

export function legacyExplorerAddress(chain: LegacyChainId, addr: string): string {
  return `${LEGACY_NETWORKS[chain].explorer}/address/${addr}`;
}
