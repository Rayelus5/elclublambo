import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const readContract = vi.fn();
const getBalance = vi.fn();
const getBlockNumber = vi.fn();
const chainClient = vi.fn<(c: number) => object>(() => ({
  readContract: (...a: unknown[]) => readContract(...a),
  getBalance: (...a: unknown[]) => getBalance(...a),
  getBlockNumber: (...a: unknown[]) => getBlockNumber(...a),
}));
vi.mock("@/lib/legacy/linea-client", () => ({ legacyChainClient: (c: number) => chainClient(c) }));

import { LEGACY_NETWORKS as NETWORKS } from "@/lib/legacy/linea";
import { addressesFor, assetsUsd6, readEthPrice, readSafeAssets } from "@/lib/treasury/valuation";

const SAFE = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const FEED = "0x1111111111111111111111111111111111111111";
const WETH = "0x2222222222222222222222222222222222222222";
const NOW = 1_800_000_000;

const fetchMock = vi.fn();
const gecko = (body: string) => fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => body });

/** Chainlink feed mock: `latestRoundData` → [roundId, answer, startedAt, updatedAt, answeredInRound]. */
function feed(answer: bigint, updatedAt: number, decimals = 8) {
  readContract.mockImplementation(async (args: { functionName: string }) => {
    if (args.functionName === "latestRoundData") return [1n, answer, BigInt(updatedAt), BigInt(updatedAt), 1n];
    if (args.functionName === "decimals") return decimals;
    throw new Error(`unexpected ${args.functionName}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ETH_USD_FEED_ADDRESS_59141", FEED);
  vi.stubEnv("WETH_ADDRESS_59141", WETH);
  vi.stubEnv("COINGECKO_DISABLED", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("assetsUsd6", () => {
  it("values USDC at 1 USD and ETH + WETH at the 8-decimal price", () => {
    expect(assetsUsd6({ usdc: 5_000000n, eth: 10n ** 18n, weth: 5n * 10n ** 17n }, 2500_00000000n)).toBe(5_000000n + 3750_000000n);
  });

  it("floors once over the summed wei (matches record_nav_snapshot)", () => {
    // 4e11 wei at 1.5 USD/ETH is 0.6 usd6 each: flooring each gives 0, flooring the sum gives floor(1.2) = 1.
    expect(assetsUsd6({ usdc: 7n, eth: 4n * 10n ** 11n, weth: 4n * 10n ** 11n }, 1_50000000n)).toBe(8n);
  });
});

describe("addressesFor", () => {
  it("honours both env overrides", () => {
    expect(addressesFor(59141)).toEqual({ usdc: NETWORKS[59141].usdc, weth: WETH, ethUsdFeed: FEED, heartbeatSec: NETWORKS[59141].ethUsdHeartbeatSec });
  });

  it("falls back to the verified network values without overrides", () => {
    vi.stubEnv("ETH_USD_FEED_ADDRESS_59141", "");
    vi.stubEnv("WETH_ADDRESS_59141", "");
    expect(addressesFor(59141)).toEqual({
      usdc: NETWORKS[59141].usdc,
      weth: NETWORKS[59141].weth,
      ethUsdFeed: NETWORKS[59141].ethUsdFeed,
      heartbeatSec: NETWORKS[59141].ethUsdHeartbeatSec,
    });
  });

  it("ignores every override on Linea mainnet (ruling F4a-R10): the oracle and WETH stay the verified ones", () => {
    vi.stubEnv("ETH_USD_FEED_ADDRESS_59144", FEED);
    vi.stubEnv("WETH_ADDRESS_59144", WETH);
    expect(addressesFor(59144)).toEqual({
      usdc: NETWORKS[59144].usdc,
      weth: NETWORKS[59144].weth,
      ethUsdFeed: NETWORKS[59144].ethUsdFeed,
      heartbeatSec: NETWORKS[59144].ethUsdHeartbeatSec,
    });
    // the testnet overrides still apply
    expect(addressesFor(59141)).toMatchObject({ weth: WETH, ethUsdFeed: FEED });
  });

  it("ignores a malformed override", () => {
    vi.stubEnv("WETH_ADDRESS_59141", "not-an-address");
    expect(addressesFor(59141).weth).toBe(NETWORKS[59141].weth);
  });
});

describe("readSafeAssets", () => {
  it("reads every balance at one block number", async () => {
    getBlockNumber.mockResolvedValue(1234n);
    getBalance.mockResolvedValue(7n * 10n ** 17n);
    readContract.mockImplementation(async (args: { address: string }) => (args.address === WETH ? 3n * 10n ** 17n : 9_000000n));

    const r = await readSafeAssets(59141, SAFE);

    expect(r).toEqual({ usdc: 9_000000n, eth: 7n * 10n ** 17n, weth: 3n * 10n ** 17n, blockNumber: 1234n });
    expect(getBlockNumber).toHaveBeenCalledTimes(1);
    expect(getBalance).toHaveBeenCalledWith({ address: SAFE, blockNumber: 1234n });
    expect(readContract).toHaveBeenCalledTimes(2);
    for (const [args] of readContract.mock.calls) {
      expect(args).toMatchObject({ functionName: "balanceOf", args: [SAFE], blockNumber: 1234n });
    }
    expect(readContract.mock.calls.map(([a]) => a.address).sort()).toEqual([NETWORKS[59141].usdc, WETH].sort());
  });

  it("F4c-R7 (a): with maxBlock below the tip, every balance is read at maxBlock", async () => {
    getBlockNumber.mockResolvedValue(1234n);
    getBalance.mockResolvedValue(1n);
    readContract.mockResolvedValue(2n);
    const r = await readSafeAssets(59141, SAFE, { maxBlock: 1200n });
    expect(r.blockNumber).toBe(1200n);
    expect(getBalance).toHaveBeenCalledWith({ address: SAFE, blockNumber: 1200n });
    for (const [args] of readContract.mock.calls) expect(args).toMatchObject({ blockNumber: 1200n });
  });

  it("with maxBlock at or past the tip, reads at the tip (never a future block)", async () => {
    getBlockNumber.mockResolvedValue(1234n);
    getBalance.mockResolvedValue(1n);
    readContract.mockResolvedValue(2n);
    expect((await readSafeAssets(59141, SAFE, { maxBlock: 5000n })).blockNumber).toBe(1234n);
    expect(getBalance).toHaveBeenCalledWith({ address: SAFE, blockNumber: 1234n });
  });

  it("returns weth = 0n without reading when the chain has no WETH", async () => {
    vi.stubEnv("WETH_ADDRESS_59141", "");
    const original = NETWORKS[59141].weth;
    NETWORKS[59141].weth = null;
    try {
      getBlockNumber.mockResolvedValue(5n);
      getBalance.mockResolvedValue(0n);
      readContract.mockResolvedValue(1n);
      const r = await readSafeAssets(59141, SAFE);
      expect(r).toEqual({ usdc: 1n, eth: 0n, weth: 0n, blockNumber: 5n });
      expect(readContract).toHaveBeenCalledTimes(1);
    } finally {
      NETWORKS[59141].weth = original;
    }
  });

  it("propagates RPC failures (the caller skips the snapshot)", async () => {
    getBlockNumber.mockRejectedValue(new Error("rpc down"));
    await expect(readSafeAssets(59141, SAFE)).rejects.toThrow("rpc down");
  });
});

describe("readEthPrice", () => {
  const heartbeat = () => addressesFor(59141).heartbeatSec;

  it("uses a fresh Chainlink answer without calling CoinGecko", async () => {
    feed(2400_00000000n, NOW - 1800);
    expect(await readEthPrice(59141, { lastPriceE8: null, nowSec: NOW })).toEqual({ priceE8: 2400_00000000n, source: "chainlink" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an answer exactly at heartbeat + 10 %", async () => {
    feed(2400_00000000n, NOW - Math.floor(heartbeat() * 1.1));
    expect(await readEthPrice(59141, { lastPriceE8: null, nowSec: NOW })).toEqual({ priceE8: 2400_00000000n, source: "chainlink" });
  });

  it("falls back to CoinGecko when Chainlink is stale", async () => {
    feed(2400_00000000n, NOW - Math.floor(heartbeat() * 1.1) - 1);
    gecko('{"ethereum":{"usd":2410.5}}');
    expect(await readEthPrice(59141, { lastPriceE8: null, nowSec: NOW })).toEqual({ priceE8: 241050000000n, source: "coingecko" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    expect(init?.signal).toBeDefined();
  });

  it("treats answer <= 0 as stale", async () => {
    feed(0n, NOW - 10);
    gecko('{"ethereum":{"usd":2400}}');
    expect(await readEthPrice(59141, { lastPriceE8: null, nowSec: NOW })).toEqual({ priceE8: 2400_00000000n, source: "coingecko" });
    feed(-5n, NOW - 10);
    expect(await readEthPrice(59141, { lastPriceE8: null, nowSec: NOW })).toEqual({ priceE8: 2400_00000000n, source: "coingecko" });
  });

  it("falls back when the Chainlink read throws", async () => {
    readContract.mockRejectedValue(new Error("rpc down"));
    gecko('{"ethereum":{"usd":2400.123456789}}');
    expect(await readEthPrice(59141, { lastPriceE8: null, nowSec: NOW })).toEqual({ priceE8: 240012345678n, source: "coingecko" });
  });

  it("rescales a feed whose decimals are not 8", async () => {
    feed(2400_000000000000000000n, NOW - 10, 18);
    expect(await readEthPrice(59141, { lastPriceE8: null, nowSec: NOW })).toEqual({ priceE8: 2400_00000000n, source: "chainlink" });
    feed(2400_000000n, NOW - 10, 6);
    expect(await readEthPrice(59141, { lastPriceE8: null, nowSec: NOW })).toEqual({ priceE8: 2400_00000000n, source: "chainlink" });
  });

  it("rejects a CoinGecko price 30 % away from the last snapshot", async () => {
    feed(2400_00000000n, NOW - 100_000_000);
    gecko('{"ethereum":{"usd":3120}}');
    expect(await readEthPrice(59141, { lastPriceE8: 2400_00000000n, nowSec: NOW })).toBeNull();
    gecko('{"ethereum":{"usd":1680}}');
    expect(await readEthPrice(59141, { lastPriceE8: 2400_00000000n, nowSec: NOW })).toBeNull();
  });

  it("accepts a CoinGecko price within ±20 % of the last snapshot", async () => {
    feed(2400_00000000n, NOW - 100_000_000);
    gecko('{"ethereum":{"usd":2880}}');
    expect(await readEthPrice(59141, { lastPriceE8: 2400_00000000n, nowSec: NOW })).toEqual({ priceE8: 2880_00000000n, source: "coingecko" });
  });

  it("returns null with no feed configured and COINGECKO_DISABLED=1", async () => {
    vi.stubEnv("ETH_USD_FEED_ADDRESS_59141", "");
    vi.stubEnv("COINGECKO_DISABLED", "1");
    const original = NETWORKS[59141].ethUsdFeed;
    NETWORKS[59141].ethUsdFeed = null;
    try {
      expect(await readEthPrice(59141, { lastPriceE8: null, nowSec: NOW })).toBeNull();
      expect(readContract).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      NETWORKS[59141].ethUsdFeed = original;
    }
  });

  it("returns null on a CoinGecko error, bad status or unparseable body", async () => {
    feed(1n, NOW - 100_000_000);
    fetchMock.mockRejectedValue(new Error("timeout"));
    expect(await readEthPrice(59141, { lastPriceE8: null, nowSec: NOW })).toBeNull();
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => "" });
    expect(await readEthPrice(59141, { lastPriceE8: null, nowSec: NOW })).toBeNull();
    for (const body of ['{"ethereum":{}}', '{"ethereum":{"usd":"abc"}}', '{"ethereum":{"usd":0}}', '{"ethereum":{"usd":2.4e3}}', "nope"]) {
      gecko(body);
      expect(await readEthPrice(59141, { lastPriceE8: null, nowSec: NOW })).toBeNull();
    }
  });
});
