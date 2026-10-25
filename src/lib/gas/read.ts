import "server-only";
import { cacheLife } from "next/cache";
import { concat, decodeFunctionResult, encodeFunctionData, keccak256, slice, type Hex, type PublicClient } from "viem";
import { readEthUsd } from "@/lib/economy/eth-price";
import { chainForKey, NETWORKS, type ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { safeError } from "@/lib/security/redact";
import { GAS_ACTIONS, OP_TX_ENVELOPE_BYTES, type GasActionKey } from "./actions";
import { GAS_PRICE_ORACLE, gasPriceOracleAbi, NODE_INTERFACE, nodeInterfaceAbi } from "./oracles-abi";

/** Amounts are decimal strings (wei): serializable for the cache. `l1Wei` null = the L1 part could not be read. */
export type GasRow = { action: GasActionKey; l2Wei: string; l1Wei: string | null; totalWei: string };

export type NetworkGas =
  | { status: "ok"; chainId: ChainId; baseFeeWei: string; priorityWei: string; rows: GasRow[]; l1Status: "ok" | "unavailable" }
  | { status: "unavailable"; chainId: ChainId };

export type GasSnapshot = {
  networks: NetworkGas[];
  /** Ethereum L1 as a reference only: Base's GasPriceOracle.l1BaseFee() × gas units (no RPC of its own, P6-R5). */
  ethereum: { l1BaseFeeWei: string; rows: Array<{ action: GasActionKey; totalWei: string }> } | null;
  ethUsdE8: string | null;
  readAt: string;
};

/** Fifteen seconds: about a block's worth of fee movement on an L2, and it bounds the RPC calls without a rate limit. */
export const GAS_CACHE = { stale: 15, revalidate: 15, expire: 60 } as const;

/** Deterministic, incompressible filler calldata of `bytes` bytes: keccak256 chained from the empty string. */
function fillerData(bytes: number): Hex {
  if (bytes === 0) return "0x";
  const parts: Hex[] = [];
  let h = keccak256("0x");
  for (let n = 0; n < bytes; n += 32) {
    parts.push(h);
    h = keccak256(h);
  }
  return slice(concat(parts), 0, bytes);
}

/** The L1 part of one action, in wei, on an OP Stack chain (Base): the oracle's upper bound for calldata + envelope. */
async function opL1Wei(client: PublicClient, calldataBytes: number): Promise<bigint> {
  return client.readContract({
    address: GAS_PRICE_ORACLE,
    abi: gasPriceOracleAbi,
    functionName: "getL1FeeUpperBound",
    args: [BigInt(calldataBytes + OP_TX_ENVELOPE_BYTES)],
  });
}

/** The L1 part of one action, in wei, on Arbitrum: NodeInterface's L1 gas for that calldata, priced at the L2 gas price. */
async function arbitrumL1Wei(client: PublicClient, chain: ChainId, calldataBytes: number, gasPrice: bigint): Promise<bigint> {
  const { data } = await client.call({
    to: NODE_INTERFACE,
    data: encodeFunctionData({
      abi: nodeInterfaceAbi,
      functionName: "gasEstimateL1Component",
      args: [NETWORKS[chain].usdc, false, fillerData(calldataBytes)],
    }),
  });
  if (!data) throw new Error("NodeInterface returned no data");
  const [gasForL1] = decodeFunctionResult({ abi: nodeInterfaceAbi, functionName: "gasEstimateL1Component", data });
  return gasForL1 * gasPrice;
}

/**
 * One network's cost per action (P6-R5): L2 = gas × (base fee + priority tip), plus the L1 part from the chain's own
 * oracle. A failing L1 read leaves the L2 cost (`l1Wei` null, `l1Status` unavailable); a failing block or fee read
 * makes the network unavailable. Never throws.
 */
export async function readNetworkGas(chain: ChainId, injected?: PublicClient): Promise<NetworkGas> {
  try {
    // Built inside the try: a throwing chainClient must become «unavailable», not an exception.
    const client = injected ?? chainClient(chain);
    const [block, priority] = await Promise.all([client.getBlock(), client.estimateMaxPriorityFeePerGas()]);
    const baseFee = block.baseFeePerGas;
    if (baseFee === null || baseFee === undefined) throw new Error("block without baseFeePerGas");
    const gasPrice = baseFee + priority;
    const isArbitrum = NETWORKS[chain].key === "arbitrum";

    const l1 = await Promise.all(
      GAS_ACTIONS.map((a) =>
        (isArbitrum ? arbitrumL1Wei(client, chain, a.calldataBytes, gasPrice) : opL1Wei(client, a.calldataBytes)).catch((e: unknown) => {
          console.error("[gas] L1 part unavailable", chain, a.key, safeError(e));
          return null;
        }),
      ),
    );
    const rows: GasRow[] = GAS_ACTIONS.map((a, i) => {
      const l2 = a.gas * gasPrice;
      const l1Wei = l1[i] ?? null;
      return { action: a.key, l2Wei: String(l2), l1Wei: l1Wei === null ? null : String(l1Wei), totalWei: String(l2 + (l1Wei ?? 0n)) };
    });
    return {
      status: "ok",
      chainId: chain,
      baseFeeWei: String(baseFee),
      priorityWei: String(priority),
      rows,
      l1Status: l1.every((x) => x !== null) ? "ok" : "unavailable",
    };
  } catch (e) {
    console.error("[gas] network unavailable", chain, safeError(e));
    return { status: "unavailable", chainId: chain };
  }
}

/** Ethereum's base fee as Base's oracle last saw it, × each action's gas. Null when the oracle cannot be read. */
async function readEthereumReference(baseChain: ChainId): Promise<GasSnapshot["ethereum"]> {
  try {
    const l1BaseFee = await chainClient(baseChain).readContract({ address: GAS_PRICE_ORACLE, abi: gasPriceOracleAbi, functionName: "l1BaseFee" });
    return { l1BaseFeeWei: String(l1BaseFee), rows: GAS_ACTIONS.map((a) => ({ action: a.key, totalWei: String(a.gas * l1BaseFee) })) };
  } catch (e) {
    console.error("[gas] Ethereum reference unavailable", safeError(e));
    return null;
  }
}

/** Base and Arbitrum of this build in parallel, the Ethereum reference and the ETH price (Chainlink on Base, P6-R7). */
export async function readGasSnapshot(): Promise<GasSnapshot> {
  const base = chainForKey("base");
  const arbitrum = chainForKey("arbitrum");
  const [baseGas, arbitrumGas, ethereum, price] = await Promise.all([
    readNetworkGas(base),
    readNetworkGas(arbitrum),
    readEthereumReference(base),
    readEthUsd(base),
  ]);
  return { networks: [baseGas, arbitrumGas], ethereum, ethUsdE8: price ? String(price.priceE8) : null, readAt: new Date().toISOString() };
}

/** `readGasSnapshot` through a 15-second cache. Request time only (the page calls it after `connection()`). */
export async function getGasSnapshot(): Promise<GasSnapshot> {
  "use cache";
  cacheLife(GAS_CACHE);
  return readGasSnapshot();
}
