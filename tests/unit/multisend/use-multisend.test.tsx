import { act, renderHook } from "@testing-library/react";
import { encodeEventTopics, erc20Abi, numberToHex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = { tag: "wagmi-config" };
const caps = vi.hoisted(() => ({ value: { data: undefined, error: null, fetchStatus: "idle" } as { data: unknown; error: unknown; fetchStatus: string } }));
const useCapabilities = vi.hoisted(() => vi.fn());
const sendCallsAsync = vi.hoisted(() => vi.fn());
vi.mock("wagmi", () => ({
  useConfig: () => config,
  useCapabilities: (p: unknown) => {
    useCapabilities(p);
    return caps.value;
  },
  useSendCalls: () => ({ sendCallsAsync }),
}));
const nonces = vi.hoisted(() => ({ pending: 5 as number | Error, latest: 5 }));
const publicClient = {
  tag: "public-client",
  getTransactionCount: vi.fn(async ({ blockTag }: { blockTag: string }) => {
    const n = blockTag === "pending" ? nonces.pending : nonces.latest;
    if (n instanceof Error) throw n;
    return n;
  }),
};
const waitForTransactionReceipt = vi.hoisted(() => vi.fn());
const waitForCallsStatus = vi.hoisted(() => vi.fn());
const getBlockNumber = vi.hoisted(() => vi.fn());
const getPublicClient = vi.hoisted(() => vi.fn());
vi.mock("wagmi/actions", () => ({ waitForTransactionReceipt, waitForCallsStatus, getBlockNumber, getPublicClient }));
const findTransfer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/multisend/find-transfer", async (orig) => ({ ...(await orig<typeof import("@/lib/multisend/find-transfer")>()), findTransfer }));
const ensure = vi.hoisted(() => vi.fn<(chainId: number) => Promise<boolean>>());
vi.mock("@/lib/payments/use-ensure-chain", () => ({ useEnsureChain: () => ({ ensure, switching: false, failedFor: null }) }));
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-send-transfer", () => ({ useSendTransfer: () => ({ send }) }));
const readAssetBalance = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/balances", () => ({ readAssetBalance }));

import { resetMultisendMemory, useMultisend } from "@/lib/multisend/use-multisend";
import { loadProgress, recentConfirmed, saveProgress, type RowState } from "@/lib/multisend/progress";
import { lineId, type ParsedLine } from "@/lib/multisend/parse";
import { lockKey, LOCK_STALE_MS, TAB_ID } from "@/lib/multisend/run-lock";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const A = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const B = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const C = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as const;
const USDC_BASE = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const USDC_ARB = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const SUFFIX = "0x62635f7465737407" + "00" + "80218021802180218021802180218021";
const h = (n: number) => `0x${n.toString(16).padStart(2, "0").repeat(32)}` as `0x${string}`;
const line = (n: number, to: `0x${string}`, amount: bigint): ParsedLine => ({ line: n, to, amount, id: lineId(to, amount, 0) });
const rows: ParsedLine[] = [line(1, A, 10_000_000n), line(2, B, 12_500_000n), line(3, C, 7_500_000n)];
const ALL = new Set(rows.map((r) => r.id));
const KEY = "list-key";
const userRejected = Object.assign(new Error("User rejected the request."), { name: "UserRejectedRequestError", code: 4001 });
const row = (r: ParsedLine, extra: Partial<RowState> & { status: RowState["status"] }): RowState => ({ id: r.id, to: r.to, amount: r.amount.toString(), ...extra });
const STALE = () => Date.now() - 11 * 60_000;
const attempt = (at = Date.now(), block = "900") => ({ block, at });

/** A USDC Transfer(OWNER → to, amount) log, as a receipt carries it. */
function transferLog(to: `0x${string}`, amount: bigint, token: `0x${string}` = USDC_BASE, from: `0x${string}` = OWNER) {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }),
    data: numberToHex(amount, { size: 32 }),
    blockNumber: 1n,
    transactionHash: h(0),
    logIndex: 0,
    blockHash: h(0),
    transactionIndex: 0,
    removed: false,
  };
}
const paying = (hash: `0x${string}`, ...pays: Array<[`0x${string}`, bigint]>) => ({
  status: "success",
  transactionHash: hash,
  logs: pays.map(([to, amount]) => transferLog(to, amount)),
});
/** The receipt of what the wallet sent for each line of `rows` (by order of send). */
function receiptsPay() {
  waitForTransactionReceipt.mockImplementation(async (_c: unknown, { hash }: { hash: `0x${string}` }) => {
    const n = Number.parseInt(hash.slice(2, 4), 16);
    const r = rows[n - 1]!;
    return paying(hash, [r.to, r.amount]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetMultisendMemory();
  vi.stubEnv("NEXT_PUBLIC_BASE_BUILDER_CODE", "bc_test");
  caps.value = { data: undefined, error: new Error("wallet_getCapabilities not supported"), fetchStatus: "idle" };
  ensure.mockResolvedValue(true);
  readAssetBalance.mockResolvedValue(10n ** 12n);
  // The wallet returns h(n) for line n, and its receipt pays that line.
  send.mockImplementation(async ({ to }: { to: string }) => h(rows.findIndex((r) => r.to === to) + 1));
  receiptsPay();
  sendCallsAsync.mockResolvedValue({ id: "0xbatch" });
  waitForCallsStatus.mockResolvedValue({ status: "success", statusCode: 200, receipts: [paying(h(99), ...rows.map((r): [`0x${string}`, bigint] => [r.to, r.amount]))] });
  getBlockNumber.mockResolvedValue(4242n);
  getPublicClient.mockReturnValue(publicClient);
  findTransfer.mockResolvedValue(null);
  nonces.pending = 5;
  nonces.latest = 5;
});
afterEach(() => vi.restoreAllMocks());

function throwingStorage() {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
}

describe("useMultisend mode", () => {
  it("atomic when the wallet says supported or ready on this chain, asked with the chainId", () => {
    caps.value = { data: { atomic: { status: "supported" } }, error: null, fetchStatus: "idle" };
    const { result, rerender } = renderHook(() => useMultisend(84532));
    expect(useCapabilities).toHaveBeenCalledWith(expect.objectContaining({ chainId: 84532 }));
    expect(result.current.mode).toBe("atomic");
    caps.value = { data: { atomic: { status: "ready" } }, error: null, fetchStatus: "idle" };
    rerender();
    expect(result.current.mode).toBe("atomic");
  });

  it("getCapabilities throwing, unsupported or nothing at all → sequential; fetching → checking", () => {
    const { result, rerender } = renderHook(() => useMultisend(84532));
    expect(result.current.mode).toBe("sequential");
    caps.value = { data: { atomic: { status: "unsupported" } }, error: null, fetchStatus: "idle" };
    rerender();
    expect(result.current.mode).toBe("sequential");
    caps.value = { data: undefined, error: null, fetchStatus: "fetching" };
    rerender();
    expect(result.current.mode).toBe("checking");
  });
});

describe("useMultisend atomic", () => {
  beforeEach(() => {
    caps.value = { data: { atomic: { status: "supported" } }, error: null, fetchStatus: "idle" };
  });

  it("on Base: one sendCalls with 3 transfers, forceAtomic, the account pinned and the Builder Code in every call; confirmed by the Transfer logs", async () => {
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(ensure.mock.invocationCallOrder[0]!).toBeLessThan(sendCallsAsync.mock.invocationCallOrder[0]!);
    expect(sendCallsAsync).toHaveBeenCalledWith({
      chainId: 84532,
      account: OWNER,
      forceAtomic: true,
      calls: rows.map((r) => ({ to: USDC_BASE, abi: erc20Abi, functionName: "transfer", args: [r.to, r.amount], dataSuffix: SUFFIX })),
    });
    expect(send).not.toHaveBeenCalled();
    expect(waitForCallsStatus).toHaveBeenCalledWith(config, { id: "0xbatch" });
    expect(result.current.rows.map((r) => [r.status, r.hash])).toEqual(rows.map(() => ["confirmed", h(99)]));
    expect(result.current.error).toBeNull();
  });

  it("on Arbitrum: no dataSuffix in any call", async () => {
    const { result } = renderHook(() => useMultisend(421614));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    const calls = sendCallsAsync.mock.calls[0]![0].calls as Record<string, unknown>[];
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c).not.toHaveProperty("dataSuffix");
      expect(c.to).toBe(USDC_ARB);
    }
  });

  it("finding 3: every line's attempt is stored before the prompt; a partial batch (600) leaves every line unconfirmed and nothing is ever re-signed", async () => {
    sendCallsAsync.mockImplementation(async () => {
      const stored = loadProgress(OWNER, 84532, KEY)!;
      expect(stored.every((r) => r.status === "unconfirmed" && r.attempt?.block === "4242")).toBe(true);
      return { id: "0xbatch" };
    });
    // Line 1 moved, lines 2 and 3 did not.
    waitForCallsStatus.mockResolvedValue({ status: "failure", statusCode: 600, receipts: [paying(h(99), [A, 10_000_000n])] });
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(result.current.rows.map((r) => r.status)).toEqual(["unconfirmed", "unconfirmed", "unconfirmed"]);
    expect(result.current.error).toBe("atomic_failed");
    act(() => result.current.sendOneByOne());
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(sendCallsAsync).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(findTransfer).toHaveBeenCalledTimes(3);
  });

  it("finding 3: a batch the wallet errors on (not a rejection) leaves every line unconfirmed; a rejection returns them to todo", async () => {
    sendCallsAsync.mockRejectedValueOnce(new Error("relay lost"));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(result.current.rows.map((r) => r.status)).toEqual(["unconfirmed", "unconfirmed", "unconfirmed"]);
    resetMultisendMemory();
    window.localStorage.clear();
    sendCallsAsync.mockRejectedValueOnce(userRejected);
    const second = renderHook(() => useMultisend(84532));
    await act(() => second.result.current.send(rows, OWNER, KEY, ALL));
    expect(second.result.current.rows.every((r) => r.status === "todo" && r.attempt)).toBe(true);
    expect(second.result.current.error).toBe("cancelled");
  });

  it("a batch still pending on resume is re-checked once per batch id, in one shared wait", async () => {
    saveProgress(OWNER, 84532, KEY, rows.map((r) => row(r, { callsId: "0xold", attempt: attempt(), status: "sent" })));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, new Set()));
    expect(waitForCallsStatus).toHaveBeenCalledTimes(1);
    expect(waitForCallsStatus).toHaveBeenCalledWith(config, expect.objectContaining({ id: "0xold" }));
    expect(sendCallsAsync).not.toHaveBeenCalled();
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
  });
});

describe("useMultisend sequential", () => {
  it("one transfer per row, account pinned; the attempt is stored before each prompt and the receipt hash after", async () => {
    send.mockImplementation(async ({ to }: { to: string }) => {
      const stored = loadProgress(OWNER, 84532, KEY)!.find((r) => r.to === to)!;
      expect(stored).toMatchObject({ status: "unconfirmed", attempt: { block: "4242" } });
      return h(rows.findIndex((r) => r.to === to) + 1);
    });
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).toHaveBeenCalledTimes(3);
    rows.forEach((r, i) => expect(send).toHaveBeenNthCalledWith(i + 1, { chain: 84532, token: "USDC", to: r.to, amount: r.amount, account: OWNER }));
    expect(ensure.mock.invocationCallOrder[0]!).toBeLessThan(send.mock.invocationCallOrder[0]!);
    expect(result.current.rows.map((r) => [r.status, r.hash])).toEqual([
      ["confirmed", h(1)],
      ["confirmed", h(2)],
      ["confirmed", h(3)],
    ]);
    expect(recentConfirmed(84532, Date.now()).map((e) => e.hash)).toEqual([h(1), h(2), h(3)]);
  });

  it("finding 1: with storage unavailable, the in-memory state is the truth: a confirmed line is never signed again", async () => {
    throwingStorage();
    send.mockResolvedValueOnce(h(1)).mockRejectedValueOnce(userRejected);
    const { result } = renderHook(() => useMultisend(84532));
    expect(result.current.storageOk).toBe(true);
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(result.current.storageOk).toBe(false);
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "todo", "todo"]);
    send.mockImplementation(async ({ to }: { to: string }) => h(rows.findIndex((r) => r.to === to) + 1));
    // A caller that (wrongly) approves every line: line 1 is confirmed and stays so.
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([A, B, B, C]);
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
  });

  it("finding 2: a wallet error that is not a rejection leaves the line unconfirmed; it is never re-signed", async () => {
    send.mockResolvedValueOnce(h(1)).mockRejectedValueOnce(new Error("WalletConnect: response lost"));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "unconfirmed", "todo"]);
    expect(result.current.error).toBe("failed");
    send.mockImplementation(async ({ to }: { to: string }) => h(rows.findIndex((r) => r.to === to) + 1));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([A, B, C]);
    expect(result.current.rows[1]!.status).toBe("unconfirmed");
    expect(findTransfer).toHaveBeenCalledWith(publicClient, expect.objectContaining({ to: B, fromBlock: 4242n }));
  });

  it("finding 2: a reload while the prompt was open finds the attempt and does not sign that line again", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { status: "unconfirmed", attempt: attempt() }), row(rows[1]!, { status: "todo" }), row(rows[2]!, { status: "todo" })]);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([B, C]);
    expect(result.current.rows[0]!.status).toBe("unconfirmed");
    expect(result.current.error).toBe("unconfirmed");
  });

  it("finding 2: a definitive rejection returns the line to todo but keeps the attempt, so it is scanned before the next signature", async () => {
    send.mockRejectedValueOnce(userRejected);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(result.current.rows[0]).toMatchObject({ status: "todo", attempt: { block: "4242" } });
    expect(result.current.error).toBe("cancelled");
    send.mockImplementation(async ({ to }: { to: string }) => h(rows.findIndex((r) => r.to === to) + 1));
    findTransfer.mockResolvedValueOnce(h(77));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(findTransfer.mock.calls[0]![1]).toMatchObject({ to: A });
    expect(result.current.rows[0]).toMatchObject({ status: "confirmed", hash: h(77) });
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([A, B, C]);
  });

  it("finding 4: a receipt without the USDC Transfer (a cancel) is not a confirmation: unconfirmed, not recorded, never re-signed", async () => {
    waitForTransactionReceipt.mockResolvedValueOnce({ status: "success", transactionHash: h(50), logs: [] });
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows.slice(0, 1), OWNER, KEY, ALL));
    expect(result.current.rows[0]!.status).toBe("unconfirmed");
    expect(result.current.error).toBe("reverted");
    expect(recentConfirmed(84532, Date.now())).toEqual([]);
    await act(() => result.current.send(rows.slice(0, 1), OWNER, KEY, ALL));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("finding 4: a log for another token, sender, recipient or amount does not count", async () => {
    waitForTransactionReceipt.mockResolvedValueOnce({
      status: "success",
      transactionHash: h(50),
      logs: [transferLog(A, 1n), transferLog(B, 10_000_000n), transferLog(A, 10_000_000n, USDC_ARB as `0x${string}`), transferLog(A, 10_000_000n, USDC_BASE, B)],
    });
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows.slice(0, 1), OWNER, KEY, ALL));
    expect(result.current.rows[0]!.status).toBe("unconfirmed");
  });

  it("finding 4: a sped-up tx is confirmed with the hash of the receipt that paid", async () => {
    waitForTransactionReceipt.mockResolvedValueOnce(paying(h(66), [A, 10_000_000n]));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows.slice(0, 1), OWNER, KEY, ALL));
    expect(result.current.rows[0]).toMatchObject({ status: "confirmed", hash: h(66) });
  });

  it("finding 5: a released line whose scan fails is scan_failed and is not signed", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { hash: h(7), attempt: attempt(STALE()), status: "not_found" }), row(rows[1]!, { status: "confirmed" }), row(rows[2]!, { status: "confirmed" })]);
    findTransfer.mockRejectedValueOnce(new Error("range too large"));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, new Set(), new Set([rows[0]!.id])));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.rows[0]!.status).toBe("scan_failed");
    expect(result.current.error).toBe("scan_failed");
  });

  it("finding 5: a scan_failed line cannot be released; a retried successful scan makes it not_found, and only then a release signs it", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { hash: h(7), attempt: attempt(STALE()), status: "scan_failed" }), row(rows[1]!, { status: "confirmed" }), row(rows[2]!, { status: "confirmed" })]);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL, new Set([rows[0]!.id])));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.rows[0]!.status).toBe("not_found");
    expect(result.current.error).toBe("unconfirmed");
    await act(() => result.current.send(rows, OWNER, KEY, new Set(), new Set([rows[0]!.id])));
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.rows[0]).toMatchObject({ status: "confirmed", hash: h(1) });
    // finding 7: a released line confirmed in this run leaves no «sin confirmar» notice behind.
    expect(result.current.error).toBeNull();
  });

  it("C1: an attempted line with nothing on chain is unconfirmed while fresh and not_found once stale; a found one is confirmed", async () => {
    saveProgress(OWNER, 84532, KEY, [
      row(rows[0]!, { attempt: attempt(), status: "unconfirmed" }),
      row(rows[1]!, { attempt: attempt(STALE()), status: "unconfirmed" }),
      row(rows[2]!, { attempt: attempt(STALE()), status: "unconfirmed" }),
    ]);
    findTransfer.mockImplementation(async (_c: unknown, { to }: { to: string }) => (to === C ? h(55) : null));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.rows.map((r) => r.status)).toEqual(["unconfirmed", "not_found", "confirmed"]);
    expect(result.current.rows[2]!.hash).toBe(h(55));
    expect(findTransfer).toHaveBeenCalledWith(publicClient, { usdc: USDC_BASE, from: OWNER, to: A, amount: 10_000_000n, fromBlock: 900n, maxBlocks: 50_000n, exclude: new Set() });
  });

  it("only todo lines and released not_found lines are signed; an approved unconfirmed line is not", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { attempt: attempt(STALE()), status: "not_found" }), row(rows[1]!, { attempt: attempt(), status: "unconfirmed" }), row(rows[2]!, { status: "todo" })]);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([C]);
  });

  it("finding 8: sent lines are re-checked in parallel under one shared timeout", async () => {
    saveProgress(OWNER, 84532, KEY, rows.map((r, i) => row(r, { hash: h(i + 1), attempt: attempt(), status: "sent" })));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    waitForTransactionReceipt.mockImplementation(async (_c: unknown, { hash }: { hash: `0x${string}` }) => {
      await gate;
      const r = rows[Number.parseInt(hash.slice(2, 4), 16) - 1]!;
      return paying(hash, [r.to, r.amount]);
    });
    const { result } = renderHook(() => useMultisend(84532));
    let done!: Promise<void>;
    act(() => {
      done = result.current.send(rows, OWNER, KEY, new Set());
    });
    await vi.waitFor(() => expect(waitForTransactionReceipt).toHaveBeenCalledTimes(3));
    const timeouts = waitForTransactionReceipt.mock.calls.map((c) => c[1].timeout as number);
    expect(new Set(timeouts).size).toBe(1);
    release();
    await act(() => done);
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
  });

  it("a sent line whose receipt does not come is never re-signed; the approved todo lines still go", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { hash: h(7), attempt: attempt(), status: "sent" }), row(rows[1]!, { status: "todo" }), row(rows[2]!, { status: "todo" })]);
    waitForTransactionReceipt.mockRejectedValueOnce(new Error("timeout"));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([B, C]);
    expect(result.current.rows[0]!.status).toBe("unconfirmed");
  });

  it("C3: progress resumes for the same lines in another order", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[2]!, { status: "todo" }), row(rows[0]!, { hash: h(7), status: "confirmed" }), row(rows[1]!, { status: "todo" })]);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([B, C]);
  });

  it("a refused chain switch signs nothing and leaves no attempt", async () => {
    ensure.mockResolvedValue(false);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.error).toBe("switch");
    expect(result.current.rows.every((r) => r.status === "todo" && !r.attempt)).toBe(true);
  });

  it("finding 12: a known-short balance signs nothing; an unknown one does not block", async () => {
    readAssetBalance.mockImplementation(async (_c: unknown, asset: { token: string }) => (asset.token === "USDC" ? 29_999_999n : 10n ** 18n));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.error).toBe("insufficient");
    readAssetBalance.mockImplementation(async (_c: unknown, asset: { token: string }) => (asset.token === "USDC" ? 30_000_000n : 0n));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(result.current.error).toBe("no_gas");
    expect(send).not.toHaveBeenCalled();
    readAssetBalance.mockRejectedValue(new Error("rpc down"));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("all rows already confirmed: nothing to sign, not even a chain switch", async () => {
    saveProgress(OWNER, 84532, KEY, rows.map((r, i) => row(r, { hash: h(i + 1), status: "confirmed" })));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(ensure).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("every run bumps `runs` (the form clears its ticks on it)", async () => {
    const { result } = renderHook(() => useMultisend(84532));
    expect(result.current.runs).toBe(0);
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(result.current.runs).toBe(1);
  });
});

describe("fix round 3", () => {
  const RUN_KEY = `elclub:multisend:84532:${OWNER.toLowerCase()}:${KEY}`;
  const notFound = () => [row(rows[0]!, { hash: h(7), attempt: attempt(STALE()), status: "not_found" }), row(rows[1]!, { status: "todo" }), row(rows[2]!, { status: "confirmed" })];

  it("R1: a released line is not signed while the wallet has a pending tx; the todo lines still go", async () => {
    saveProgress(OWNER, 84532, KEY, notFound());
    nonces.pending = 6;
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, new Set([rows[1]!.id]), new Set([rows[0]!.id])));
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([B]);
    expect(result.current.rows[0]!.status).toBe("not_found");
    expect(result.current.error).toBe("wallet_pending");
    expect(publicClient.getTransactionCount).toHaveBeenCalledWith({ address: OWNER, blockTag: "pending" });
  });

  it("R1: a failed nonce read also keeps a released line unsigned (the safe side)", async () => {
    saveProgress(OWNER, 84532, KEY, notFound());
    nonces.pending = new Error("rpc");
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, new Set(), new Set([rows[0]!.id])));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.error).toBe("wallet_pending");
  });

  it("R1: with no pending tx, the released line is signed", async () => {
    saveProgress(OWNER, 84532, KEY, notFound());
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, new Set(), new Set([rows[0]!.id])));
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([A]);
  });

  it("R3: the scan cap follows the chain (400k blocks on Arbitrum)", async () => {
    saveProgress(OWNER, 421614, KEY, [row(rows[0]!, { attempt: attempt(STALE(), "77"), status: "unconfirmed" }), row(rows[1]!, { status: "confirmed" }), row(rows[2]!, { status: "confirmed" })]);
    const { result } = renderHook(() => useMultisend(421614));
    await act(() => result.current.send(rows, OWNER, KEY, new Set()));
    expect(findTransfer.mock.calls[0]![1]).toMatchObject({ fromBlock: 77n, maxBlocks: 400_000n });
  });

  it("R3: an attempt without its block at send cannot be scanned: scan_failed, never tickable", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { attempt: { at: STALE() }, status: "unconfirmed" }), row(rows[1]!, { status: "confirmed" }), row(rows[2]!, { status: "confirmed" })]);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, new Set()));
    expect(findTransfer).not.toHaveBeenCalled();
    expect(result.current.rows[0]!.status).toBe("scan_failed");
  });

  it("R3: when the block at send cannot be read, nothing is signed and no attempt is written", async () => {
    getBlockNumber.mockRejectedValue(new Error("rpc down"));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.error).toBe("rpc");
    expect(result.current.rows.every((r) => r.status === "todo" && !r.attempt)).toBe(true);
  });

  it("R5: while another tab holds a fresh lock on this list, a run does nothing", async () => {
    window.localStorage.setItem(lockKey(RUN_KEY), JSON.stringify({ tab: "other-tab", beat: Date.now() - 5_000 }));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).not.toHaveBeenCalled();
    expect(findTransfer).not.toHaveBeenCalled();
    expect(result.current.error).toBe("locked");
    expect(JSON.parse(window.localStorage.getItem(lockKey(RUN_KEY))!).tab).toBe("other-tab");
  });

  it("R5: a stale lock (> 30 s) is taken over; the run holds the lock while signing and releases it after", async () => {
    window.localStorage.setItem(lockKey(RUN_KEY), JSON.stringify({ tab: "other-tab", beat: Date.now() - LOCK_STALE_MS - 1 }));
    send.mockImplementation(async ({ to }: { to: string }) => {
      expect(JSON.parse(window.localStorage.getItem(lockKey(RUN_KEY))!).tab).toBe(TAB_ID);
      return h(rows.findIndex((r) => r.to === to) + 1);
    });
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).toHaveBeenCalledTimes(3);
    expect(window.localStorage.getItem(lockKey(RUN_KEY))).toBeNull();
  });
});
