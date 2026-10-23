import { isChainId, NETWORKS, type ChainId, type NetworkKey } from "@/lib/economy/networks";
import { TOKEN_DECIMALS, type Token } from "@/lib/payments/amounts";

/** A payable asset is a (token, network) pair, e.g. "USDC:84532". */
export type AssetId = `${Token}:${ChainId}`;
/** `contract` is null for native ETH. */
export type Asset = { id: AssetId; token: Token; chainId: ChainId; decimals: number; contract: `0x${string}` | null };
/** Balances in base units; null or missing = unknown (not read yet, or the read failed). */
export type AssetBalances = Partial<Record<AssetId, bigint | null>>;

const TOKENS: readonly Token[] = ["USDC", "ETH"];

export function assetId(token: Token, chainId: ChainId): AssetId {
  return `${token}:${chainId}`;
}

function asset(token: Token, chainId: ChainId): Asset {
  return {
    id: assetId(token, chainId),
    token,
    chainId,
    decimals: TOKEN_DECIMALS[token],
    contract: token === "USDC" ? NETWORKS[chainId].usdc : null,
  };
}

export function parseAssetId(s: string): Asset | null {
  const m = /^(USDC|ETH):(\d+)$/.exec(s);
  if (!m) return null;
  const chainId = Number(m[2]);
  return isChainId(chainId) ? asset(m[1] as Token, chainId) : null;
}

/** USDC of every chain (in `chainIds` order), then ETH of every chain; only networks in `accept` when given. */
export function assetsFor(chainIds: readonly ChainId[], accept?: readonly NetworkKey[]): Asset[] {
  const chains = accept ? chainIds.filter((c) => accept.includes(NETWORKS[c].key)) : chainIds;
  return TOKENS.flatMap((t) => chains.map((c) => asset(t, c)));
}

/**
 * 0 can pay: USDC balance >= amount with ETH > 0 on that chain for gas; ETH balance > amount (the rest pays gas).
 * Without an amount, any positive balance (and gas for USDC). 1 has a balance but not enough. 2 zero. 3 unknown.
 */
function rank(a: Asset, balances: AssetBalances, amount: bigint | null): number {
  const bal = balances[a.id];
  if (bal === null || bal === undefined) return 3;
  if (bal === 0n) return 2;
  if (a.token === "ETH") return (amount === null ? bal > 0n : bal > amount) ? 0 : 1;
  const gas = balances[assetId("ETH", a.chainId)];
  const enough = amount === null || bal >= amount;
  return enough && gas !== null && gas !== undefined && gas > 0n ? 0 : 1;
}

/** Stable sort by what the payer can pay (no USD conversion, P0-R8). */
export function rankAssets(assets: readonly Asset[], balances: AssetBalances, amount: bigint | null): Asset[] {
  return assets
    .map((a, i) => ({ a, i, r: rank(a, balances, amount) }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map((x) => x.a);
}
