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

import { readReceipt } from "@/lib/pay/inspect";

const CHAIN = 84532 as const;
const HASH = `0x${"AB".repeat(32)}` as `0x${string}`;
const PAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const notFound = Object.assign(new Error("nf"), { name: "TransactionReceiptNotFoundError" });

function mined(head: bigint) {
  client.getChainId.mockResolvedValue(CHAIN);
  client.getTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 100n, blockHash: "0xbeef", logs: [] });
  client.getTransaction.mockResolvedValue({ from: PAYER, to: TO, value: 5n });
  client.getBlockNumber.mockResolvedValue(head);
  client.getBlock.mockResolvedValue({ timestamp: 1_800_000_000n });
}

beforeEach(() => {
  vi.clearAllMocks();
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
  });

  it("an error is returned fresh and not cached", async () => {
    client.getChainId.mockRejectedValue(new Error("down"));
    expect(await readReceipt(CHAIN, HASH)).toEqual({ status: "error", code: "rpc_unavailable" });
    expect(cacheLife).not.toHaveBeenCalled();
  });

  it("a final payment goes through the cached read, tagged with the lowercase hash", async () => {
    mined(110n);
    const r = await readReceipt(CHAIN, HASH);
    expect(r).toMatchObject({ status: "ok", final: true });
    expect(cacheLife).toHaveBeenCalledWith("max");
    expect(cacheTag).toHaveBeenCalledWith(`pay-receipt:${CHAIN}:${HASH.toLowerCase()}`);
  });
});
