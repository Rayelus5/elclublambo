import "server-only";
import { erc20Abi, isAddress, type Address } from "viem";
import { safeError } from "@/lib/security/redact";
import { LEGACY_NETWORKS, type LegacyChainId } from "@/lib/legacy/linea";
import { legacyChainClient } from "@/lib/legacy/linea-client";

export type SafeAssets = { usdc: bigint; eth: bigint; weth: bigint; blockNumber: bigint };
export type EthPrice = { priceE8: bigint; source: "chainlink" | "coingecko" };

const PRICE_DECIMALS = 8;
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
const COINGECKO_TIMEOUT_MS = 5000;
/** A CoinGecko price further than this from the last snapshot's price is rejected as bad data. */
const COINGECKO_MAX_DRIFT_PCT = 20n;

const aggregatorAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

function envAddress(name: string): Address | null {
  const v = process.env[name]?.trim();
  return v && isAddress(v) ? v : null;
}

/** The chain's USDC, WETH and ETH/USD feed. `WETH_ADDRESS_59141` / `ETH_USD_FEED_ADDRESS_59141` override (tests, local chain). */
export function addressesFor(chain: LegacyChainId): { usdc: Address; weth: Address | null; ethUsdFeed: Address | null; heartbeatSec: number } {
  const net = LEGACY_NETWORKS[chain];
  // Ruling F4a-R10: overrides only on the testnet (the local e2e chain reuses 59141); a stray env var must never swap
  // mainnet's price oracle or WETH, which set the NAV that shares are issued at.
  const testnet = chain === 59141;
  return {
    usdc: net.usdc,
    weth: (testnet ? envAddress(`WETH_ADDRESS_${chain}`) : null) ?? net.weth,
    ethUsdFeed: (testnet ? envAddress(`ETH_USD_FEED_ADDRESS_${chain}`) : null) ?? net.ethUsdFeed,
    heartbeatSec: net.ethUsdHeartbeatSec,
  };
}

/**
 * The Safe's USDC, native ETH and WETH balances, all read at one block: the latest, or `maxBlock` when that is older
 * (ruling F4c-R7 a: the scan cursor while withdrawals are approved and unpaid). RPC errors propagate (the caller skips),
 * including a node that no longer serves state that old.
 */
export async function readSafeAssets(chain: LegacyChainId, safe: Address, opts: { maxBlock?: bigint } = {}): Promise<SafeAssets> {
  const client = legacyChainClient(chain);
  const { usdc, weth } = addressesFor(chain);
  const latest = await client.getBlockNumber();
  const blockNumber = opts.maxBlock !== undefined && opts.maxBlock < latest ? opts.maxBlock : latest;
  const balanceOf = (token: Address) =>
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [safe], blockNumber });
  const [usdcBal, eth, wethBal] = await Promise.all([
    balanceOf(usdc),
    client.getBalance({ address: safe, blockNumber }),
    weth ? balanceOf(weth) : Promise.resolve(0n),
  ]);
  return { usdc: usdcBal, eth, weth: wethBal, blockNumber };
}

/** `usdc + floor((eth + weth) · priceE8 / 10^20)`: one floor over the summed wei, exactly as `record_nav_snapshot` checks. */
export function assetsUsd6(a: { usdc: bigint; eth: bigint; weth: bigint }, priceE8: bigint): bigint {
  return a.usdc + ((a.eth + a.weth) * priceE8) / 10n ** 20n;
}

function rescaleToE8(answer: bigint, decimals: number): bigint {
  if (decimals === PRICE_DECIMALS) return answer;
  return decimals < PRICE_DECIMALS
    ? answer * 10n ** BigInt(PRICE_DECIMALS - decimals)
    : answer / 10n ** BigInt(decimals - PRICE_DECIMALS);
}

/** A fresh, positive Chainlink answer in 8 decimals, or null (no feed, stale, non-positive or read error). */
async function chainlinkPrice(chain: LegacyChainId, nowSec: number): Promise<bigint | null> {
  const { ethUsdFeed, heartbeatSec } = addressesFor(chain);
  if (!ethUsdFeed) return null;
  try {
    const client = legacyChainClient(chain);
    const [round, decimals] = await Promise.all([
      client.readContract({ address: ethUsdFeed, abi: aggregatorAbi, functionName: "latestRoundData" }),
      client.readContract({ address: ethUsdFeed, abi: aggregatorAbi, functionName: "decimals" }),
    ]);
    const answer = round[1];
    const updatedAt = round[3];
    // Fresh when age <= heartbeat · 1.1, compared in integers: age · 10 <= heartbeat · 11.
    const age = BigInt(Math.floor(nowSec)) - updatedAt;
    if (answer <= 0n || age * 10n > BigInt(heartbeatSec) * 11n) return null;
    const priceE8 = rescaleToE8(answer, Number(decimals));
    return priceE8 > 0n ? priceE8 : null;
  } catch (e) {
    console.error("[treasury] chainlink read failed", chain, safeError(e));
    return null;
  }
}

/** "2410.5" -> 241050000000n without floats (cut to 8 decimals). Null for anything that is not a plain decimal. */
function parseUsdE8(text: string): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m?.[1]) return null;
  return BigInt(m[1]) * 10n ** 8n + BigInt((m[2] ?? "").slice(0, PRICE_DECIMALS).padEnd(PRICE_DECIMALS, "0"));
}

async function coingeckoPrice(): Promise<bigint | null> {
  if (process.env.COINGECKO_DISABLED === "1") return null;
  try {
    const res = await fetch(COINGECKO_URL, { signal: AbortSignal.timeout(COINGECKO_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    // Read the raw number from the body: JSON.parse would turn it into a float.
    const m = /"ethereum"\s*:\s*\{[^}]*"usd"\s*:\s*([0-9][0-9.eE+-]*)/.exec(await res.text());
    const priceE8 = m?.[1] ? parseUsdE8(m[1]) : null;
    return priceE8 && priceE8 > 0n ? priceE8 : null;
  } catch (e) {
    console.error("[treasury] coingecko read failed", safeError(e));
    return null;
  }
}

/**
 * ETH/USD in 8 decimals. Chainlink when fresh (heartbeat + 10 %) and positive; otherwise CoinGecko, accepted only
 * within ±20 % of the last snapshot's price (or when there is none); otherwise null: credits and snapshots wait.
 */
export async function readEthPrice(chain: LegacyChainId, opts: { lastPriceE8: bigint | null; nowSec?: number }): Promise<EthPrice | null> {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const chainlink = await chainlinkPrice(chain, nowSec);
  if (chainlink !== null) return { priceE8: chainlink, source: "chainlink" };

  const gecko = await coingeckoPrice();
  if (gecko === null) return null;
  const last = opts.lastPriceE8;
  if (last !== null && last > 0n) {
    const drift = gecko > last ? gecko - last : last - gecko;
    if (drift * 100n > last * COINGECKO_MAX_DRIFT_PCT) {
      console.error("[treasury] coingecko price rejected: too far from the last snapshot", String(gecko), String(last));
      return null;
    }
  }
  return { priceE8: gecko, source: "coingecko" };
}
