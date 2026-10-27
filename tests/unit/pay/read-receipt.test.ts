import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const cacheLife = vi.hoisted(() => vi.fn());
const cacheTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ cacheLife, cacheTag }));
const client = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
  getBlockNumber: vi.fn(),
  getBlock: vi.fn(),
}));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: () => client }));
const getProfileByAddress = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pay/queries", () => ({ getProfileByAddress }));

// Vitest ignores "use cache": this stand-in gives readFinal the directive's semantics (a returned value is stored per
// argument list and served again without running the function; a throw stores nothing).
const memo = vi.hoisted(() => new Map<string, unknown>());
const handBack = vi.hoisted(() => ({ lost: false }));
vi.mock("@/lib/pay/receipt-cache", async (orig) => {
  const real = await orig<typeof import("@/lib/pay/receipt-cache")>();
  const cached =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      const k = `${fn.name}:${JSON.stringify(a)}`;
      if (memo.has(k)) return memo.get(k) as R;
      const r = await fn(...a);
      memo.set(k, r);
      return r;
    };
  return {
    ...real,
    readFinal: cached(real.readFinal),
    getCachedProfileByAddress: cached(real.getCachedProfileByAddress),
    // `lost`: another overlapping view of the same hash already took the hand-back
    takeStashed: (k: string) => {
      const r = real.takeStashed(k);
      return handBack.lost ? undefined : r;
    },
  };
});

import { readReceipt } from "@/lib/pay/read-receipt";
import { getCachedProfileByAddress, RECEIPT_PROFILE_CACHE } from "@/lib/pay/receipt-cache";

const CHAIN = 84532 as const;
const HASH = `0x${"AB".repeat(32)}` as `0x${string}`;
const PAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const notFound = Object.assign(new Error("nf"), { name: "TransactionReceiptNotFoundError" });

const rpcCalls = () => Object.values(client).reduce((n, f) => n + f.mock.calls.length, 0);

function mined(head: bigint) {
  client.getChainId.mockResolvedValue(CHAIN);
  client.getTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 100n, blockHash: "0xbeef", logs: [] });
  client.getTransaction.mockResolvedValue({ from: PAYER, to: TO, value: 5n });
  client.getBlockNumber.mockResolvedValue(head);
  client.getBlock.mockResolvedValue({ timestamp: 1_800_000_000n });
}

beforeEach(() => {
  vi.clearAllMocks();
  memo.clear();
});

describe("readReceipt caching contract", () => {
  it("a pending view inspects once and never touches the cache", async () => {
    client.getChainId.mockResolvedValue(CHAIN);
    client.getTransactionReceipt.mockRejectedValue(notFound);
    client.getTransaction.mockResolvedValue({});
    expect(await readReceipt(CHAIN, HASH)).toEqual({ status: "pending" });
    expect(client.getChainId).toHaveBeenCalledTimes(1);
    expect(cacheLife).not.toHaveBeenCalled();
  });

  it("a non-final payment returns the fresh result and is not cached", async () => {
    mined(100n);
    const r = await readReceipt(CHAIN, HASH);
    expect(r).toMatchObject({ status: "ok", final: false });
    expect(client.getChainId).toHaveBeenCalledTimes(1);
    expect(cacheLife).not.toHaveBeenCalled();
    expect(cacheTag).not.toHaveBeenCalled();
    // and the next view reads the chain again
    await readReceipt(CHAIN, HASH);
    expect(client.getChainId).toHaveBeenCalledTimes(2);
  });

  it("an error is returned fresh and not cached", async () => {
    client.getChainId.mockRejectedValue(new Error("down"));
    expect(await readReceipt(CHAIN, HASH)).toEqual({ status: "error", code: "rpc_unavailable" });
    expect(client.getChainId).toHaveBeenCalledTimes(1);
    expect(cacheLife).not.toHaveBeenCalled();
  });

  it("a final payment goes through the cached read, tagged with the lowercase hash", async () => {
    mined(110n);
    const r = await readReceipt(CHAIN, HASH);
    expect(r).toMatchObject({ status: "ok", final: true });
    expect(client.getChainId).toHaveBeenCalledTimes(1);
    expect(cacheLife).toHaveBeenCalledWith("max");
    expect(cacheTag).toHaveBeenCalledWith(`pay-receipt:${CHAIN}:${HASH.toLowerCase()}`);
  });

  it("the second view of a final receipt makes no RPC call (the cached read is used first)", async () => {
    mined(110n);
    const first = await readReceipt(CHAIN, HASH);
    const before = rpcCalls();
    expect(before).toBeGreaterThan(0);
    const second = await readReceipt(CHAIN, HASH.toLowerCase() as `0x${string}`);
    expect(rpcCalls()).toBe(before);
    expect(second).toEqual(first);
  });

  it("if the hand-back is missing (a concurrent view took it), one fresh inspection answers, not rpc_unavailable", async () => {
    client.getChainId.mockResolvedValue(CHAIN);
    client.getTransactionReceipt.mockRejectedValue(notFound);
    client.getTransaction.mockResolvedValue({});
    handBack.lost = true;
    try {
      expect(await readReceipt(CHAIN, HASH)).toEqual({ status: "pending" });
    } finally {
      handBack.lost = false;
    }
    expect(client.getChainId).toHaveBeenCalledTimes(2);
    expect(cacheLife).not.toHaveBeenCalled();
  });
});

describe("getCachedProfileByAddress", () => {
  it("reads the profile once a minute per address (lowercased)", async () => {
    getProfileByAddress.mockResolvedValue({ alias: "ana", displayName: null });
    expect(await getCachedProfileByAddress(TO)).toEqual({ alias: "ana", displayName: null });
    expect(getProfileByAddress).toHaveBeenCalledWith(TO.toLowerCase());
    expect(cacheLife).toHaveBeenCalledWith(RECEIPT_PROFILE_CACHE);
    expect(RECEIPT_PROFILE_CACHE.revalidate).toBe(60);
    await getCachedProfileByAddress(TO);
    expect(getProfileByAddress).toHaveBeenCalledTimes(1);
  });
});
