import "server-only";
import { isAddress, type PublicClient } from "viem";
import { isChainId, networkSet, type ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { safeError } from "@/lib/security/redact";

/**
 * Chainlink ETH/USD per network, verified on-chain with description() = "ETH / USD" on 2026-10-24 (P1-R5).
 * `heartbeatSec` is the maximum accepted heartbeat; `sequencer` is the L2 sequencer uptime feed (mainnets only).
 */
export const PRICE_FEEDS: Record<ChainId, { ethUsd: `0x${string}`; heartbeatSec: number; sequencer: `0x${string}` | null }> = {
  8453: { ethUsd: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", heartbeatSec: 1200, sequencer: "0xBCF85224fc0756B9Fa45aA7892530B47e10b6433" },
  42161: { ethUsd: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612", heartbeatSec: 86400, sequencer: "0xFdB631F5EE196F0ed6FAa767959853A9F217697D" },
  84532: { ethUsd: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1", heartbeatSec: 86400, sequencer: null },
  421614: { ethUsd: "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165", heartbeatSec: 86400, sequencer: null },
};

const PRICE_DECIMALS = 8;
/** After the sequencer comes back, its price feed needs this long to settle. */
const SEQUENCER_GRACE_SEC = 3600n;

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

/** The ETH/USD feed address; ETH_USD_FEED_ADDRESS_<chainId> overrides it on testnets only (e2e). */
function feedAddress(chain: ChainId): `0x${string}` {
  if (networkSet() === "testnet") {
    const v = process.env[`ETH_USD_FEED_ADDRESS_${chain}`]?.trim();
    if (v && isAddress(v)) return v;
  }
  return PRICE_FEEDS[chain].ethUsd;
}

function rescaleToE8(answer: bigint, decimals: number): bigint {
  if (decimals === PRICE_DECIMALS) return answer;
  return decimals < PRICE_DECIMALS ? answer * 10n ** BigInt(PRICE_DECIMALS - decimals) : answer / 10n ** BigInt(decimals - PRICE_DECIMALS);
}

/**
 * ETH/USD in 8 decimals from Chainlink, or null when it cannot be trusted: stale (age > heartbeat * 1.1), answer <= 0,
 * sequencer down or back less than an hour ago, or an RPC failure. Callers wait and retry; a doubtful price never credits.
 */
export async function readEthUsd(chain: ChainId, opts: { nowSec?: number; client?: PublicClient } = {}): Promise<{ priceE8: bigint } | null> {
  if (!isChainId(chain)) return null;
  const nowSec = BigInt(Math.floor(opts.nowSec ?? Date.now() / 1000));
  const feed = PRICE_FEEDS[chain];
  try {
    const client = opts.client ?? chainClient(chain);
    const read = (address: `0x${string}`, functionName: "latestRoundData" | "decimals") =>
      client.readContract({ address, abi: aggregatorAbi, functionName }) as Promise<never>;

    if (feed.sequencer) {
      const seq = (await read(feed.sequencer, "latestRoundData")) as readonly [bigint, bigint, bigint, bigint, bigint];
      // answer 0 = up, 1 = down; startedAt is when the current status began.
      if (seq[1] !== 0n || nowSec - seq[2] < SEQUENCER_GRACE_SEC) return null;
    }

    const address = feedAddress(chain);
    const [round, decimals] = (await Promise.all([read(address, "latestRoundData"), read(address, "decimals")])) as [
      readonly [bigint, bigint, bigint, bigint, bigint],
      number,
    ];
    const answer = round[1];
    const age = nowSec - round[3];
    // Fresh when age <= heartbeat * 1.1, in integers: age * 10 <= heartbeat * 11.
    if (answer <= 0n || age * 10n > BigInt(feed.heartbeatSec) * 11n) return null;
    const priceE8 = rescaleToE8(answer, Number(decimals));
    return priceE8 > 0n ? { priceE8 } : null;
  } catch (e) {
    console.error("[economy] chainlink read failed", chain, safeError(e));
    return null;
  }
}

/** USD value in 6 decimals: USDC is itself; ETH is wei * priceE8 / 10^20 (floored). Null for ETH without a price. */
export function usd6For(token: "USDC" | "ETH", amount: bigint, priceE8: bigint | null): bigint | null {
  if (token === "USDC") return amount;
  if (priceE8 === null || priceE8 <= 0n) return null;
  return (amount * priceE8) / 10n ** 20n;
}
