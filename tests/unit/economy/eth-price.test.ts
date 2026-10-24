import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import type { PublicClient } from "viem";
import { PRICE_FEEDS, readEthUsd, usd6For } from "@/lib/economy/eth-price";

const NOW = 1_800_000_000;
const BASE_FEED = PRICE_FEEDS[8453].ethUsd;
const SEQ = PRICE_FEEDS[8453].sequencer!;

type Round = { answer: bigint; startedAt: bigint; updatedAt: bigint };
function client(feeds: Record<string, Round | Error>, decimals = 8): PublicClient {
  return {
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      const r = feeds[address.toLowerCase()];
      if (!r) throw new Error("unknown feed");
      if (r instanceof Error) throw r;
      if (functionName === "decimals") return decimals;
      return [1n, r.answer, r.startedAt, r.updatedAt, 1n];
    },
  } as unknown as PublicClient;
}
const fresh = (answer = 236045646999n, age = 60): Round => ({ answer, startedAt: BigInt(NOW - age), updatedAt: BigInt(NOW - age) });
const seqUp = (since = 10_000): Round => ({ answer: 0n, startedAt: BigInt(NOW - since), updatedAt: BigInt(NOW - since) });

afterEach(() => vi.unstubAllEnvs());

describe("readEthUsd", () => {
  it("returns a fresh feed price in 8 decimals", async () => {
    const c = client({ [BASE_FEED.toLowerCase()]: fresh(), [SEQ.toLowerCase()]: seqUp() });
    expect(await readEthUsd(8453, { nowSec: NOW, client: c })).toEqual({ priceE8: 236045646999n });
  });

  it("rescales other decimals to 8", async () => {
    const c = client({ [BASE_FEED.toLowerCase()]: fresh(2360456469n), [SEQ.toLowerCase()]: seqUp() }, 6);
    expect(await readEthUsd(8453, { nowSec: NOW, client: c })).toEqual({ priceE8: 236045646900n });
  });

  it("is null when older than heartbeat * 1.1 (base: 1200 s)", async () => {
    const stale = client({ [BASE_FEED.toLowerCase()]: fresh(236045646999n, 1321), [SEQ.toLowerCase()]: seqUp() });
    expect(await readEthUsd(8453, { nowSec: NOW, client: stale })).toBeNull();
    const edge = client({ [BASE_FEED.toLowerCase()]: fresh(236045646999n, 1320), [SEQ.toLowerCase()]: seqUp() });
    expect(await readEthUsd(8453, { nowSec: NOW, client: edge })).not.toBeNull();
  });

  it("is null for a non-positive answer", async () => {
    const c = client({ [BASE_FEED.toLowerCase()]: fresh(0n), [SEQ.toLowerCase()]: seqUp() });
    expect(await readEthUsd(8453, { nowSec: NOW, client: c })).toBeNull();
  });

  it("is null when the sequencer is down (answer 1)", async () => {
    const c = client({ [BASE_FEED.toLowerCase()]: fresh(), [SEQ.toLowerCase()]: { ...seqUp(), answer: 1n } });
    expect(await readEthUsd(8453, { nowSec: NOW, client: c })).toBeNull();
  });

  it("is null when the sequencer came back less than 3600 s ago", async () => {
    const c = client({ [BASE_FEED.toLowerCase()]: fresh(), [SEQ.toLowerCase()]: seqUp(100) });
    expect(await readEthUsd(8453, { nowSec: NOW, client: c })).toBeNull();
  });

  it("is null when the RPC fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = client({ [BASE_FEED.toLowerCase()]: new Error("rpc down"), [SEQ.toLowerCase()]: seqUp() });
    expect(await readEthUsd(8453, { nowSec: NOW, client: c })).toBeNull();
    err.mockRestore();
  });

  it("checks only freshness on testnets (no sequencer feed)", async () => {
    expect(PRICE_FEEDS[84532].sequencer).toBeNull();
    const c = client({ [PRICE_FEEDS[84532].ethUsd.toLowerCase()]: fresh(236045646999n, 80_000) });
    expect(await readEthUsd(84532, { nowSec: NOW, client: c })).toEqual({ priceE8: 236045646999n });
    const stale = client({ [PRICE_FEEDS[84532].ethUsd.toLowerCase()]: fresh(236045646999n, 95_041) });
    expect(await readEthUsd(84532, { nowSec: NOW, client: stale })).toBeNull();
  });

  it("honours ETH_USD_FEED_ADDRESS_<chain> on testnet only", async () => {
    const override = "0x1111111111111111111111111111111111111111";
    vi.stubEnv("ETH_USD_FEED_ADDRESS_84532", override);
    vi.stubEnv("ETH_USD_FEED_ADDRESS_8453", override);
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
    const t = client({ [override]: fresh(111n) });
    expect(await readEthUsd(84532, { nowSec: NOW, client: t })).toEqual({ priceE8: 111n });
    // a mainnet chain ignores the override: the real feed is read (unknown to this client, so null)
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = client({ [override]: fresh(111n) });
    expect(await readEthUsd(8453, { nowSec: NOW, client: m })).toBeNull();
    err.mockRestore();
  });

  it("ignores the override entirely on a mainnet build", async () => {
    const override = "0x1111111111111111111111111111111111111111";
    vi.stubEnv("ETH_USD_FEED_ADDRESS_84532", override);
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = client({ [override]: fresh(111n) });
    expect(await readEthUsd(84532, { nowSec: NOW, client: c })).toBeNull();
    err.mockRestore();
  });
});

describe("usd6For", () => {
  it("USDC is the amount itself", () => expect(usd6For("USDC", 1_500_000n, null)).toBe(1_500_000n));
  it("ETH converts wei * e8 to usd6", () => expect(usd6For("ETH", 10n ** 18n, 236045646999n)).toBe(2360456469n));
  it("ETH without a price is null", () => expect(usd6For("ETH", 10n ** 18n, null)).toBeNull());
});
