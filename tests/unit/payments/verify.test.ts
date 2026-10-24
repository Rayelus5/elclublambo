import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, pad } from "viem";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/treasury/valuation", async (orig) => {
  const actual = await orig<typeof import("@/lib/treasury/valuation")>();
  return { ...actual, addressesFor: vi.fn(actual.addressesFor) };
});

import { defaultConfirmations, verifyTransfer } from "@/lib/payments/verify";
import { NETWORKS } from "@/lib/economy/networks";
import { LEGACY_NETWORKS } from "@/lib/legacy/linea";
import { addressesFor } from "@/lib/treasury/valuation";

const CHAIN = 84532 as const;
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
function fakeOn(o: Opts = {}, chainId: number = CHAIN) {
  const run = <T,>(v: T | Error) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  return {
    getTransaction: vi.fn(() => run(o.tx ?? { from: PAYER, to: TO, value: 5n })),
    getTransactionReceipt: vi.fn(() => run(o.receipt ?? { status: "success", blockNumber: 100n, blockHash: "0xbeef", logs: [] })),
    getBlock: vi.fn(() => run(o.block ?? { timestamp: TS })),
    getBlockNumber: vi.fn(() => run(o.head ?? 110n)),
    getChainId: vi.fn(() => run(o.chainId ?? chainId)),
  } as never;
}

const fake = fakeOn;

const base = { chain: CHAIN, txHash: HASH, from: PAYER.toLowerCase(), to: TO.toLowerCase(), notBefore: NOT_BEFORE };
const notFound = Object.assign(new Error("not found"), { name: "TransactionNotFoundError" });

// Every test leaves TIP_CONFIRMATIONS as it found it (stubbed values, including "unset", are undone here).
afterEach(() => vi.unstubAllEnvs());

describe("verifyTransfer ETH", () => {
  const eth = { ...base, token: "ETH" as const, amount: 5n };
  it("accepts a matching native transfer (log index -1)", async () => {
    expect(await verifyTransfer(eth, fake())).toEqual({ status: "ok", logIndex: -1, value: 5n, blockNumber: 100n, blockTimestamp: new Date(Number(TS) * 1000) });
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
    expect(await verifyTransfer(usdc, fake({ receipt: rc(logs) }))).toEqual({ status: "ok", logIndex: 2, value: 1000n, blockNumber: 100n, blockTimestamp: new Date(Number(TS) * 1000) });
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

describe("verifyTransfer USDC with to: null (club expenses, any recipient)", () => {
  const anyTo = { ...base, token: "USDC" as const, amount: 1000n, to: null };
  const rc = (logs: unknown[]) => ({ status: "success", blockNumber: 100n, logs });
  it("accepts a log from the Safe to anyone and returns its index", async () => {
    const logs = [transferLog(USDC, OTHER, TO, 1000n, 0), transferLog(USDC, PAYER, OTHER, 1000n, 3)];
    expect(await verifyTransfer(anyTo, fake({ receipt: rc(logs) }))).toMatchObject({ status: "ok", logIndex: 3, value: 1000n });
  });
  it("rejects a log from another address, another value or another token", async () => {
    for (const l of [transferLog(USDC, OTHER, TO, 1000n, 0), transferLog(USDC, PAYER, TO, 999n, 0), transferLog(FAKE_TOKEN, PAYER, TO, 1000n, 0)]) {
      expect(await verifyTransfer(anyTo, fake({ receipt: rc([l]) }))).toEqual({ status: "error", code: "tx_mismatch" });
    }
  });
  it("is never accepted for native ETH", async () => {
    expect(await verifyTransfer({ ...anyTo, token: "ETH" }, fake({ tx: { from: PAYER, to: null, value: 1000n } }))).toEqual({ status: "error", code: "tx_mismatch" });
  });
});

describe("verifyTransfer USDC atLeast (withdrawal payouts)", () => {
  const payout = { ...base, token: "USDC" as const, amount: 8_000000n, atLeast: true };
  const rc = (logs: unknown[]) => ({ status: "success", blockNumber: 100n, logs });
  it("accepts a log paying more than the amount and returns the paid value", async () => {
    expect(await verifyTransfer(payout, fake({ receipt: rc([transferLog(USDC, PAYER, TO, 8_500000n, 4)]) }))).toEqual({
      status: "ok", logIndex: 4, value: 8_500000n, blockNumber: 100n, blockTimestamp: new Date(Number(TS) * 1000),
    });
  });
  it("accepts exactly the amount", async () => {
    expect(await verifyTransfer(payout, fake({ receipt: rc([transferLog(USDC, PAYER, TO, 8_000000n, 0)]) }))).toMatchObject({ status: "ok", value: 8_000000n });
  });
  it("rejects one unit short", async () => {
    expect(await verifyTransfer(payout, fake({ receipt: rc([transferLog(USDC, PAYER, TO, 7_999999n, 0)]) }))).toEqual({ status: "error", code: "tx_mismatch" });
  });
  it("rejects a log from another token contract even when it pays enough", async () => {
    expect(await verifyTransfer(payout, fake({ receipt: rc([transferLog(FAKE_TOKEN, PAYER, TO, 9_000000n, 0)]) }))).toEqual({ status: "error", code: "tx_mismatch" });
  });
  it("rejects the right amount to another wallet or from another sender", async () => {
    for (const l of [transferLog(USDC, PAYER, OTHER, 9_000000n, 0), transferLog(USDC, OTHER, TO, 9_000000n, 0)]) {
      expect(await verifyTransfer(payout, fake({ receipt: rc([l]) }))).toEqual({ status: "error", code: "tx_mismatch" });
    }
  });
  it("takes the first qualifying log in log order", async () => {
    const logs = [
      transferLog(USDC, PAYER, TO, 9_000000n, 6),
      transferLog(USDC, PAYER, TO, 1_000000n, 2),
      transferLog(USDC, PAYER, TO, 8_100000n, 3),
    ];
    expect(await verifyTransfer(payout, fake({ receipt: rc(logs) }))).toMatchObject({ status: "ok", logIndex: 3, value: 8_100000n });
  });
  it("prefers the given log index when that log qualifies, else the first qualifying log", async () => {
    const logs = [transferLog(USDC, PAYER, TO, 9_000000n, 2), transferLog(USDC, PAYER, TO, 8_100000n, 3), transferLog(USDC, PAYER, TO, 1n, 4)];
    expect(await verifyTransfer({ ...payout, preferLogIndex: 3 }, fake({ receipt: rc(logs) }))).toMatchObject({ status: "ok", logIndex: 3, value: 8_100000n });
    expect(await verifyTransfer({ ...payout, preferLogIndex: 4 }, fake({ receipt: rc(logs) }))).toMatchObject({ status: "ok", logIndex: 2 });
    expect(await verifyTransfer({ ...payout, preferLogIndex: 99 }, fake({ receipt: rc(logs) }))).toMatchObject({ status: "ok", logIndex: 2 });
  });
  it("without atLeast an overpayment is still a mismatch (exact match for tips and donations)", async () => {
    const exact = { ...payout, atLeast: undefined };
    expect(await verifyTransfer(exact, fake({ receipt: rc([transferLog(USDC, PAYER, TO, 8_500000n, 0)]) }))).toEqual({ status: "error", code: "tx_mismatch" });
  });
  it("atLeast does not relax native ETH (exact value)", async () => {
    const eth = { ...base, token: "ETH" as const, amount: 4n, atLeast: true };
    expect(await verifyTransfer(eth, fake())).toEqual({ status: "error", code: "tx_mismatch" });
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
    expect(await verifyTransfer(eth, fake({ chainId: 421614 }))).toEqual({ status: "error", code: "rpc_unavailable" });
  });
  it("tx.chainId of another chain -> tx_mismatch (ETH and USDC)", async () => {
    const tx = { from: PAYER, to: TO, value: 5n, chainId: 421614 };
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
    vi.stubEnv("TIP_CONFIRMATIONS", undefined);
    expect(await verifyTransfer(eth, fake({ head: 101n }))).toEqual({ status: "pending" });
    vi.stubEnv("TIP_CONFIRMATIONS", "1");
    expect(await verifyTransfer(eth, fake({ head: 100n }))).toMatchObject({ status: "ok" });
  });
  it("invalid TIP_CONFIRMATIONS falls back to 3", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const v of ["", "abc", "1.5", "0"]) {
      vi.stubEnv("TIP_CONFIRMATIONS", v);
      expect(await verifyTransfer(eth, fake({ head: 101n }))).toEqual({ status: "pending" });
      expect(await verifyTransfer(eth, fake({ head: 102n }))).toMatchObject({ status: "ok" });
    }
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

describe("defaultConfirmations", () => {
  it("per network without TIP_CONFIRMATIONS: Base 3, Arbitrum 20, legacy Linea 3", () => {
    vi.stubEnv("TIP_CONFIRMATIONS", undefined);
    expect(defaultConfirmations(421614)).toBe(20);
    expect(defaultConfirmations(42161)).toBe(20);
    expect(defaultConfirmations(84532)).toBe(3);
    expect(defaultConfirmations(8453)).toBe(3);
    expect(defaultConfirmations(59141)).toBe(3);
  });
  it("a valid TIP_CONFIRMATIONS wins on every network", () => {
    vi.stubEnv("TIP_CONFIRMATIONS", "1");
    expect(defaultConfirmations(421614)).toBe(1);
    expect(defaultConfirmations(59141)).toBe(1);
  });
  it("an invalid TIP_CONFIRMATIONS falls back to the network's", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TIP_CONFIRMATIONS", "abc");
    expect(defaultConfirmations(421614)).toBe(20);
  });
  it("Arbitrum Sepolia waits 20 blocks by default", async () => {
    vi.stubEnv("TIP_CONFIRMATIONS", undefined);
    const eth = { ...base, chain: 421614 as const, token: "ETH" as const, amount: 5n };
    expect(await verifyTransfer(eth, fake({ head: 118n }, 421614))).toEqual({ status: "pending" });
    expect(await verifyTransfer(eth, fake({ head: 119n }, 421614))).toMatchObject({ status: "ok" });
  });
});

describe("verifyTransfer on the new networks", () => {
  const rc = (logs: unknown[]) => ({ status: "success", blockNumber: 100n, logs });
  it("USDC of Arbitrum Sepolia is read from its own registry entry", async () => {
    const usdc = NETWORKS[421614].usdc;
    const input = { ...base, chain: 421614 as const, token: "USDC" as const, amount: 1000n, confirmations: 1 };
    expect(await verifyTransfer(input, fake({ receipt: rc([transferLog(usdc, PAYER, TO, 1000n, 0)]) }, 421614))).toMatchObject({ status: "ok" });
    // Base Sepolia's USDC on Arbitrum Sepolia is a lookalike.
    expect(await verifyTransfer(input, fake({ receipt: rc([transferLog(USDC, PAYER, TO, 1000n, 0)]) }, 421614))).toEqual({ status: "error", code: "tx_mismatch" });
  });
  it("WETH on a new network is always tx_mismatch (no WETH there)", async () => {
    vi.mocked(addressesFor).mockClear();
    const prize = { ...base, token: "WETH" as const, amount: 10n ** 16n, atLeast: true };
    const anyLog = transferLog("0x2222222222222222222222222222222222222222", PAYER, TO, 10n ** 16n, 0);
    expect(await verifyTransfer(prize, fake({ receipt: rc([anyLog]) }))).toEqual({ status: "error", code: "tx_mismatch" });
    expect(addressesFor).not.toHaveBeenCalled();
  });
});

// Legacy island (P0-R2): raffle prizes stay on Linea until P1, so these cases keep 59141.
describe("verifyTransfer WETH (raffle prizes, legacy Linea)", () => {
  const LCHAIN = 59141 as const;
  const LUSDC = LEGACY_NETWORKS[LCHAIN].usdc;
  const MOCK_WETH = "0x2222222222222222222222222222222222222222";
  const prize = { ...base, chain: LCHAIN, token: "WETH" as const, amount: 10n ** 16n, atLeast: true };
  const rc = (logs: unknown[]) => ({ status: "success", blockNumber: 100n, logs });
  const fake = (o: Opts = {}) => fakeOn(o, LCHAIN);
  const withWeth = (weth: `0x${string}` | null) =>
    vi.mocked(addressesFor).mockImplementation((chain) => ({ usdc: LEGACY_NETWORKS[chain].usdc, weth, ethUsdFeed: null, heartbeatSec: 86400 }));

  it("legacy USDC still verifies against the Linea contract", async () => {
    withWeth(MOCK_WETH);
    const usdcIn = { ...base, chain: LCHAIN, token: "USDC" as const, amount: 1000n };
    expect(await verifyTransfer(usdcIn, fake({ receipt: rc([transferLog(LUSDC, PAYER, TO, 1000n, 0)]) }))).toMatchObject({ status: "ok" });
  });

  it("atLeast matches a log of the WETH contract paying 0,0105 against 0,01", async () => {
    withWeth(MOCK_WETH);
    expect(await verifyTransfer(prize, fake({ receipt: rc([transferLog(MOCK_WETH, PAYER, TO, 105n * 10n ** 14n, 3)]) }))).toEqual({
      status: "ok", logIndex: 3, value: 105n * 10n ** 14n, blockNumber: 100n, blockTimestamp: new Date(Number(TS) * 1000),
    });
  });
  it("reads the WETH address from addressesFor (the env override of the local chain)", async () => {
    withWeth(MOCK_WETH);
    await verifyTransfer(prize, fake({ receipt: rc([transferLog(MOCK_WETH, PAYER, TO, 10n ** 16n, 0)]) }));
    expect(addressesFor).toHaveBeenCalledWith(LCHAIN);
  });
  it("a USDC log for a WETH target is a mismatch, and a WETH log for a USDC target too", async () => {
    withWeth(MOCK_WETH);
    expect(await verifyTransfer(prize, fake({ receipt: rc([transferLog(LUSDC, PAYER, TO, 10n ** 18n, 0)]) }))).toEqual({ status: "error", code: "tx_mismatch" });
    const usdcPrize = { ...base, chain: LCHAIN, token: "USDC" as const, amount: 1_000000n, atLeast: true };
    expect(await verifyTransfer(usdcPrize, fake({ receipt: rc([transferLog(MOCK_WETH, PAYER, TO, 10n ** 18n, 0)]) }))).toEqual({ status: "error", code: "tx_mismatch" });
  });
  it("one wei short is a mismatch", async () => {
    withWeth(MOCK_WETH);
    expect(await verifyTransfer(prize, fake({ receipt: rc([transferLog(MOCK_WETH, PAYER, TO, 10n ** 16n - 1n, 0)]) }))).toEqual({ status: "error", code: "tx_mismatch" });
  });
  it("without a WETH contract on the chain, WETH is always a mismatch", async () => {
    withWeth(null);
    expect(await verifyTransfer(prize, fake({ receipt: rc([transferLog(MOCK_WETH, PAYER, TO, 10n ** 16n, 0)]) }))).toEqual({ status: "error", code: "tx_mismatch" });
  });
  it("WETH without atLeast is exact", async () => {
    withWeth(MOCK_WETH);
    const exact = { ...prize, atLeast: undefined };
    expect(await verifyTransfer(exact, fake({ receipt: rc([transferLog(MOCK_WETH, PAYER, TO, 10n ** 16n + 1n, 0)]) }))).toEqual({ status: "error", code: "tx_mismatch" });
    expect(await verifyTransfer(exact, fake({ receipt: rc([transferLog(MOCK_WETH, PAYER, TO, 10n ** 16n, 0)]) }))).toMatchObject({ status: "ok" });
  });
});
