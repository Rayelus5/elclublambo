import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// NEW-1: the hook and the real findTransfer together. Only wagmi and the chain (a fake public client) are simulated.
const caps = vi.hoisted(() => ({ value: { data: { atomic: { status: "supported" } }, error: null, fetchStatus: "idle" } as { data: unknown; error: unknown; fetchStatus: string } }));
const sendCallsAsync = vi.hoisted(() => vi.fn());
vi.mock("wagmi", () => ({
  useConfig: () => ({}),
  useCapabilities: () => caps.value,
  useSendCalls: () => ({ sendCallsAsync }),
}));
const waitForTransactionReceipt = vi.hoisted(() => vi.fn());
const waitForCallsStatus = vi.hoisted(() => vi.fn());
const getBlockNumber = vi.hoisted(() => vi.fn());
const getPublicClient = vi.hoisted(() => vi.fn());
vi.mock("wagmi/actions", () => ({ waitForTransactionReceipt, waitForCallsStatus, getBlockNumber, getPublicClient }));
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-ensure-chain", () => ({ useEnsureChain: () => ({ ensure: async () => true, switching: false, failedFor: null }) }));
vi.mock("@/lib/payments/use-send-transfer", () => ({ useSendTransfer: () => ({ send }) }));
vi.mock("@/lib/payments/balances", () => ({ readAssetBalance: async () => 10n ** 12n }));

import { parseRecipients } from "@/lib/multisend/parse";
import { saveProgress, type RowState } from "@/lib/multisend/progress";
import { resetMultisendMemory, useMultisend } from "@/lib/multisend/use-multisend";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const A = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const B = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const C = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const LIST = `${A},10\n${B},12,5\n${C},7.5`;
const KEY = "batch-list";
const BATCH_TX = `0x${"aa".repeat(32)}` as const;
const lower = (s: string) => s.toLowerCase();

/** What the chain holds: USDC Transfer logs, by tx. One atomic batch tx carries the transfers of every line. */
let chainLogs: Array<{ from: string; to: string; value: bigint; transactionHash: `0x${string}`; blockNumber: bigint }> = [];
const publicClient = {
  getBlockNumber: vi.fn(async () => 5_000n),
  getTransactionCount: vi.fn(async () => 3),
  // eth_getLogs filtered by topic1 (from) and topic2 (to) in the block range, decoded as viem returns them.
  getLogs: vi.fn(async ({ args, fromBlock, toBlock }: { args: { from: string; to: string }; fromBlock: bigint; toBlock: bigint }) =>
    chainLogs
      .filter((l) => lower(l.from) === lower(args.from) && lower(l.to) === lower(args.to) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock)
      .map((l) => ({ transactionHash: l.transactionHash, blockNumber: l.blockNumber, args: { from: l.from, to: l.to, value: l.value } })),
  ),
};

const { recipients } = parseRecipients(LIST, 84532);
const minedBatch = () => (chainLogs = recipients.map((r) => ({ from: OWNER, to: r.to, value: r.amount, transactionHash: BATCH_TX, blockNumber: 4_300n })));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetMultisendMemory();
  chainLogs = [];
  caps.value = { data: { atomic: { status: "supported" } }, error: null, fetchStatus: "idle" };
  getPublicClient.mockReturnValue(publicClient);
  getBlockNumber.mockResolvedValue(4_242n);
  sendCallsAsync.mockResolvedValue({ id: "0xbatch" });
});
afterEach(() => vi.restoreAllMocks());

describe("NEW-1: a batch confirmed by the scan, line by line", () => {
  it("the parser already sums one address's lines, so no two lines can match the same (recipient, amount) log", () => {
    const merged = parseRecipients(`${A},1\n${lower(A)},2\n${B},3`, 84532).recipients;
    expect(merged.map((r) => [r.to, r.amount])).toEqual([
      [A, 3_000_000n],
      [B, 3_000_000n],
    ]);
    expect(new Set(merged.map((r) => lower(r.to))).size).toBe(merged.length);
  });

  it("a batch that ended without success (600) but was mined: the next check confirms every line with the one batch tx; nothing is signed again", async () => {
    waitForCallsStatus.mockResolvedValue({ status: "failure", statusCode: 600, receipts: [] });
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(recipients, OWNER, KEY, new Set(recipients.map((r) => r.id))));
    expect(result.current.rows.map((r) => r.status)).toEqual(["unconfirmed", "unconfirmed", "unconfirmed"]);
    minedBatch();
    await act(() => result.current.send(recipients, OWNER, KEY, new Set(), new Set()));
    expect(result.current.rows.map((r) => [r.status, r.hash])).toEqual(recipients.map(() => ["confirmed", BATCH_TX]));
    expect(sendCallsAsync).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("a reload while the batch prompt was open (no batch id, attempts past the give-up): every line is found in the batch tx, none becomes tickable", async () => {
    const at = Date.now() - 11 * 60_000;
    saveProgress(
      OWNER,
      84532,
      KEY,
      recipients.map((r): RowState => ({ id: r.id, to: r.to, amount: r.amount.toString(), attempt: { block: "4242", at }, status: "unconfirmed" })),
    );
    minedBatch();
    const { result } = renderHook(() => useMultisend(84532));
    // Even a caller that (wrongly) approves and releases every line signs nothing.
    const all = new Set(recipients.map((r) => r.id));
    await act(() => result.current.send(recipients, OWNER, KEY, all, all));
    expect(result.current.rows.map((r) => [r.status, r.hash])).toEqual(recipients.map(() => ["confirmed", BATCH_TX]));
    expect(sendCallsAsync).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("a batch whose status never came (timeout): mined later, every line confirms on the next check", async () => {
    waitForCallsStatus.mockRejectedValueOnce(new Error("timeout"));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(recipients, OWNER, KEY, new Set(recipients.map((r) => r.id))));
    expect(result.current.error).toBe("pending");
    minedBatch();
    await act(() => result.current.send(recipients, OWNER, KEY, new Set(), new Set()));
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(sendCallsAsync).toHaveBeenCalledTimes(1);
  });
});
