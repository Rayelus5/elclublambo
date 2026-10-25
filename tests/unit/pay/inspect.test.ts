import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, erc20Abi } from "viem";

vi.mock("server-only", () => ({}));

import { inspectTransfer } from "@/lib/pay/inspect";
import { NETWORKS } from "@/lib/economy/networks";

const CHAIN = 84532 as const;
const USDC = NETWORKS[CHAIN].usdc;
const PAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const OTHER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const FAKE_TOKEN = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}` as const;
const TS = 1_800_000_000n;

function transferLog(address: string, from: string, to: string, value: bigint, logIndex: number) {
  return {
    address,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: from as `0x${string}`, to: to as `0x${string}` } }),
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    logIndex,
    blockNumber: 100n,
    transactionHash: HASH,
    blockHash: `0x${"cd".repeat(32)}`,
    transactionIndex: 0,
    removed: false,
  };
}

type Opts = { tx?: Record<string, unknown> | Error; receipt?: Record<string, unknown> | Error; head?: bigint | Error; chainId?: number | Error };
function fake(o: Opts = {}) {
  const run = <T,>(v: T | Error) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  return {
    getTransaction: vi.fn(() => run(o.tx ?? { from: PAYER, to: TO, value: 5n })),
    getTransactionReceipt: vi.fn(() => run(o.receipt ?? { status: "success", blockNumber: 100n, blockHash: "0xbeef", logs: [] })),
    getBlock: vi.fn(() => Promise.resolve({ timestamp: TS })),
    getBlockNumber: vi.fn(() => run(o.head ?? 110n)),
    getChainId: vi.fn(() => run(o.chainId ?? CHAIN)),
  } as never;
}
const notFound = Object.assign(new Error("not found"), { name: "TransactionNotFoundError" });
const receiptNotFound = Object.assign(new Error("not found"), { name: "TransactionReceiptNotFoundError" });
const okReceipt = (logs: unknown[]) => ({ status: "success", blockNumber: 100n, blockHash: "0xbeef", logs });

afterEach(() => vi.unstubAllEnvs());

describe("inspectTransfer", () => {
  it("decodes a native transfer", async () => {
    expect(await inspectTransfer(CHAIN, HASH, fake())).toEqual({
      status: "ok", final: true, confirmations: 11, token: "ETH", from: PAYER, to: TO, amount: 5n, blockTimestamp: Number(TS),
    });
  });

  it("decodes the official USDC Transfer", async () => {
    const r = await inspectTransfer(CHAIN, HASH, fake({ tx: { from: PAYER, to: USDC, value: 0n }, receipt: okReceipt([transferLog(USDC, PAYER, TO, 2_500_000n, 3)]) }));
    expect(r).toMatchObject({ status: "ok", token: "USDC", from: PAYER, to: TO, amount: 2_500_000n });
  });

  it("with several USDC logs takes the first by log index", async () => {
    const r = await inspectTransfer(CHAIN, HASH, fake({ receipt: okReceipt([transferLog(USDC, PAYER, OTHER, 9n, 7), transferLog(USDC, PAYER, TO, 4n, 2)]) }));
    expect(r).toMatchObject({ status: "ok", token: "USDC", to: TO, amount: 4n });
  });

  it("a reverted transaction is tx_failed", async () => {
    expect(await inspectTransfer(CHAIN, HASH, fake({ receipt: { status: "reverted", blockNumber: 100n, blockHash: "0xbeef", logs: [] } }))).toEqual({ status: "error", code: "tx_failed" });
  });

  it("an unknown transaction is tx_not_found", async () => {
    expect(await inspectTransfer(CHAIN, HASH, fake({ receipt: receiptNotFound, tx: notFound }))).toEqual({ status: "error", code: "tx_not_found" });
  });

  it("a broadcast but unmined transaction is pending", async () => {
    expect(await inspectTransfer(CHAIN, HASH, fake({ receipt: receiptNotFound }))).toEqual({ status: "pending" });
  });

  it("a transfer of another token (no value) is not_a_payment", async () => {
    const r = await inspectTransfer(CHAIN, HASH, fake({ tx: { from: PAYER, to: FAKE_TOKEN, value: 0n }, receipt: okReceipt([transferLog(FAKE_TOKEN, PAYER, TO, 5n, 0)]) }));
    expect(r).toEqual({ status: "error", code: "not_a_payment" });
  });

  it("below the confirmations it is ok but not final", async () => {
    vi.stubEnv("TIP_CONFIRMATIONS", "3");
    const r = await inspectTransfer(CHAIN, HASH, fake({ head: 101n }));
    expect(r).toMatchObject({ status: "ok", final: false, confirmations: 2 });
  });

  it("an RPC failure or a wrong chain is rpc_unavailable", async () => {
    expect(await inspectTransfer(CHAIN, HASH, fake({ chainId: new Error("down") }))).toEqual({ status: "error", code: "rpc_unavailable" });
    expect(await inspectTransfer(CHAIN, HASH, fake({ chainId: 1 }))).toEqual({ status: "error", code: "rpc_unavailable" });
    expect(await inspectTransfer(CHAIN, HASH, fake({ head: new Error("down") }))).toEqual({ status: "error", code: "rpc_unavailable" });
  });
});
