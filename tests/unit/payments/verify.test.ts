import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, pad } from "viem";

vi.mock("server-only", () => ({}));

import { verifyTransfer } from "@/lib/payments/verify";
import { NETWORKS } from "@/lib/economy/networks";

const CHAIN = 59141 as const;
const USDC = NETWORKS[CHAIN].usdc;
const PAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const OTHER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const FAKE_TOKEN = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}` as const;
const NOT_BEFORE = new Date("2026-10-18T12:00:00Z");
const TS = BigInt(Math.floor(NOT_BEFORE.getTime() / 1000)) + 30n;

function transferLog(address: string, from: string, to: string, value: bigint, logIndex: number) {
  const topics = encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: from as `0x${string}`, to: to as `0x${string}` } });
  return {
    address,
    topics,
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    logIndex,
    blockNumber: 100n,
    transactionHash: HASH,
    blockHash: `0x${"cd".repeat(32)}`,
    transactionIndex: 0,
    removed: false,
  };
}

type Opts = {
  tx?: Record<string, unknown> | Error;
  receipt?: Record<string, unknown> | Error;
  block?: Record<string, unknown> | Error;
  head?: bigint | Error;
  chainId?: number | Error;
};
function fake(o: Opts = {}) {
  const run = <T,>(v: T | Error) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  return {
    getTransaction: vi.fn(() => run(o.tx ?? { from: PAYER, to: TO, value: 5n })),
    getTransactionReceipt: vi.fn(() => run(o.receipt ?? { status: "success", blockNumber: 100n, blockHash: "0xbeef", logs: [] })),
    getBlock: vi.fn(() => run(o.block ?? { timestamp: TS })),
    getBlockNumber: vi.fn(() => run(o.head ?? 110n)),
    getChainId: vi.fn(() => run(o.chainId ?? CHAIN)),
  } as never;
}

const base = { chain: CHAIN, txHash: HASH, from: PAYER.toLowerCase(), to: TO.toLowerCase(), notBefore: NOT_BEFORE };
const notFound = Object.assign(new Error("not found"), { name: "TransactionNotFoundError" });

describe("verifyTransfer ETH", () => {
  const eth = { ...base, token: "ETH" as const, amount: 5n };
  it("accepts a matching native transfer (log index -1)", async () => {
    expect(await verifyTransfer(eth, fake())).toEqual({ status: "ok", logIndex: -1, blockNumber: 100n });
  });
  it("rejects wrong to / value / from", async () => {
    for (const tx of [{ from: PAYER, to: OTHER, value: 5n }, { from: PAYER, to: TO, value: 6n }, { from: OTHER, to: TO, value: 5n }]) {
      expect(await verifyTransfer(eth, fake({ tx }))).toEqual({ status: "error", code: "tx_mismatch" });
    }
  });
  it("rejects a contract call with null to", async () => {
    expect(await verifyTransfer(eth, fake({ tx: { from: PAYER, to: null, value: 5n } }))).toEqual({ status: "error", code: "tx_mismatch" });
  });
});

describe("verifyTransfer USDC", () => {
  const usdc = { ...base, token: "USDC" as const, amount: 1000n };
  const rc = (logs: unknown[]) => ({ status: "success", blockNumber: 100n, logs });
  it("picks the right log among several", async () => {
    const logs = [
      transferLog(USDC, PAYER, OTHER, 1000n, 0),
      transferLog(USDC, PAYER, TO, 999n, 1),
      transferLog(USDC, PAYER, TO, 1000n, 2),
    ];
    expect(await verifyTransfer(usdc, fake({ receipt: rc(logs) }))).toEqual({ status: "ok", logIndex: 2, blockNumber: 100n });
  });
  it("matches the usdc address case-insensitively", async () => {
    const logs = [transferLog(USDC.toLowerCase(), PAYER, TO, 1000n, 7)];
    expect(await verifyTransfer(usdc, fake({ receipt: rc(logs) }))).toMatchObject({ status: "ok", logIndex: 7 });
  });
  it("rejects a lookalike token contract", async () => {
    expect(await verifyTransfer(usdc, fake({ receipt: rc([transferLog(FAKE_TOKEN, PAYER, TO, 1000n, 0)]) }))).toEqual({ status: "error", code: "tx_mismatch" });
  });
  it("rejects value off by one, wrong from, wrong to", async () => {
    for (const l of [transferLog(USDC, PAYER, TO, 1001n, 0), transferLog(USDC, OTHER, TO, 1000n, 0), transferLog(USDC, PAYER, OTHER, 1000n, 0)]) {
      expect(await verifyTransfer(usdc, fake({ receipt: rc([l]) }))).toEqual({ status: "error", code: "tx_mismatch" });
    }
  });
  it("ignores undecodable logs", async () => {
    const junk = { ...transferLog(USDC, PAYER, TO, 1000n, 0), topics: [pad("0x01")] };
    expect(await verifyTransfer(usdc, fake({ receipt: rc([junk]) }))).toEqual({ status: "error", code: "tx_mismatch" });
  });
});

describe("verifyTransfer status, timing and RPC", () => {
  const eth = { ...base, token: "ETH" as const, amount: 5n };
  it("reverted receipt -> tx_failed", async () => {
    expect(await verifyTransfer(eth, fake({ receipt: { status: "reverted", blockNumber: 100n, logs: [] } }))).toEqual({ status: "error", code: "tx_failed" });
  });
  it("unknown tx -> tx_not_found", async () => {
    expect(await verifyTransfer(eth, fake({ receipt: notFound, tx: notFound }))).toEqual({ status: "error", code: "tx_not_found" });
    expect(await verifyTransfer(eth, fake({ tx: notFound }))).toEqual({ status: "error", code: "tx_not_found" });
  });
  it("tx known but receipt not yet available -> pending", async () => {
    const e = Object.assign(new Error("x"), { name: "TransactionReceiptNotFoundError" });
    expect(await verifyTransfer(eth, fake({ receipt: e }))).toEqual({ status: "pending" });
  });
  it("RPC on another chain -> rpc_unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await verifyTransfer(eth, fake({ chainId: 59144 }))).toEqual({ status: "error", code: "rpc_unavailable" });
  });
  it("tx.chainId of another chain -> tx_mismatch (ETH and USDC)", async () => {
    const tx = { from: PAYER, to: TO, value: 5n, chainId: 59144 };
    expect(await verifyTransfer(eth, fake({ tx }))).toEqual({ status: "error", code: "tx_mismatch" });
    const usdcIn = { ...base, token: "USDC" as const, amount: 1000n };
    const receipt = { status: "success", blockNumber: 100n, blockHash: "0xbeef", logs: [transferLog(USDC, PAYER, TO, 1000n, 0)] };
    expect(await verifyTransfer(usdcIn, fake({ tx, receipt }))).toEqual({ status: "error", code: "tx_mismatch" });
    expect(await verifyTransfer(usdcIn, fake({ tx: { ...tx, chainId: CHAIN }, receipt }))).toMatchObject({ status: "ok" });
  });
  it("too few confirmations -> pending; enough -> ok", async () => {
    expect(await verifyTransfer({ ...eth, confirmations: 3 }, fake({ head: 101n }))).toEqual({ status: "pending" });
    expect(await verifyTransfer({ ...eth, confirmations: 3 }, fake({ head: 102n }))).toMatchObject({ status: "ok" });
    expect(await verifyTransfer({ ...eth, confirmations: 1 }, fake({ head: 100n }))).toMatchObject({ status: "ok" });
  });
  it("defaults confirmations to TIP_CONFIRMATIONS env, else 3", async () => {
    vi.unstubAllEnvs();
    delete process.env.TIP_CONFIRMATIONS;
    expect(await verifyTransfer(eth, fake({ head: 101n }))).toEqual({ status: "pending" });
    vi.stubEnv("TIP_CONFIRMATIONS", "1");
    expect(await verifyTransfer(eth, fake({ head: 100n }))).toMatchObject({ status: "ok" });
    vi.unstubAllEnvs();
  });
  it("invalid TIP_CONFIRMATIONS falls back to 3", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const v of ["", "abc", "1.5", "0"]) {
      vi.stubEnv("TIP_CONFIRMATIONS", v);
      expect(await verifyTransfer(eth, fake({ head: 101n }))).toEqual({ status: "pending" });
      expect(await verifyTransfer(eth, fake({ head: 102n }))).toMatchObject({ status: "ok" });
    }
    vi.unstubAllEnvs();
  });
  it("block older than notBefore - 120 s -> tx_too_old; exactly at the edge is fine", async () => {
    const nb = BigInt(Math.floor(NOT_BEFORE.getTime() / 1000));
    expect(await verifyTransfer(eth, fake({ block: { timestamp: nb - 121n } }))).toEqual({ status: "error", code: "tx_too_old" });
    expect(await verifyTransfer(eth, fake({ block: { timestamp: nb - 120n } }))).toMatchObject({ status: "ok" });
  });
  it("RPC failures -> rpc_unavailable", async () => {
    const boom = new Error("ECONNRESET");
    expect(await verifyTransfer(eth, fake({ tx: boom }))).toEqual({ status: "error", code: "rpc_unavailable" });
    expect(await verifyTransfer(eth, fake({ receipt: boom }))).toEqual({ status: "error", code: "rpc_unavailable" });
    expect(await verifyTransfer(eth, fake({ block: boom }))).toEqual({ status: "error", code: "rpc_unavailable" });
    expect(await verifyTransfer(eth, fake({ head: boom }))).toEqual({ status: "error", code: "rpc_unavailable" });
  });
});
