import { act, renderHook } from "@testing-library/react";
import { erc20Abi } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const publicClient = { tag: "public-client" };
const waitForTransactionReceipt = vi.hoisted(() => vi.fn());
const waitForCallsStatus = vi.hoisted(() => vi.fn());
const getBlockNumber = vi.hoisted(() => vi.fn());
const getPublicClient = vi.hoisted(() => vi.fn());
vi.mock("wagmi/actions", () => ({ waitForTransactionReceipt, waitForCallsStatus, getBlockNumber, getPublicClient }));
const findTransfer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/multisend/find-transfer", () => ({ findTransfer }));
const ensure = vi.hoisted(() => vi.fn<(chainId: number) => Promise<boolean>>());
vi.mock("@/lib/payments/use-ensure-chain", () => ({ useEnsureChain: () => ({ ensure, switching: false, failedFor: null }) }));
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-send-transfer", () => ({ useSendTransfer: () => ({ send }) }));
const readAssetBalance = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/balances", () => ({ readAssetBalance }));

import { useMultisend } from "@/lib/multisend/use-multisend";
import { loadProgress, recentConfirmed, saveProgress, type RowState } from "@/lib/multisend/progress";
import { lineId, type ParsedLine } from "@/lib/multisend/parse";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const A = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const B = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const C = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as const;
const USDC_BASE = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
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

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_BASE_BUILDER_CODE", "bc_test");
  caps.value = { data: undefined, error: new Error("wallet_getCapabilities not supported"), fetchStatus: "idle" };
  ensure.mockResolvedValue(true);
  readAssetBalance.mockResolvedValue(10n ** 12n);
  let n = 0;
  send.mockImplementation(async () => h(++n));
  waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  sendCallsAsync.mockResolvedValue({ id: "0xbatch" });
  waitForCallsStatus.mockResolvedValue({ status: "success", receipts: [{ transactionHash: h(99) }] });
  getBlockNumber.mockResolvedValue(4242n);
  getPublicClient.mockReturnValue(publicClient);
  findTransfer.mockResolvedValue(null);
});

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
    caps.value = { data: {}, error: null, fetchStatus: "idle" };
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

  it("on Base: one sendCalls with 3 transfers, forceAtomic, the account pinned and the Builder Code in every call", async () => {
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(ensure).toHaveBeenCalledWith(84532);
    expect(sendCallsAsync).toHaveBeenCalledTimes(1);
    expect(ensure.mock.invocationCallOrder[0]!).toBeLessThan(sendCallsAsync.mock.invocationCallOrder[0]!);
    expect(sendCallsAsync).toHaveBeenCalledWith({
      chainId: 84532,
      account: OWNER,
      forceAtomic: true,
      calls: rows.map((r) => ({ to: USDC_BASE, abi: erc20Abi, functionName: "transfer", args: [r.to, r.amount], dataSuffix: SUFFIX })),
    });
    expect(send).not.toHaveBeenCalled();
    expect(waitForCallsStatus).toHaveBeenCalledWith(config, { id: "0xbatch" });
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(result.current.rows.every((r) => r.hash === h(99))).toBe(true);
    expect(result.current.error).toBeNull();
    expect(loadProgress(OWNER, 84532, KEY)!.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
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

  it("the batch id and the block before signing are stored before waiting; a failed batch leaves every row failed and offers one by one", async () => {
    waitForCallsStatus.mockImplementation(async () => {
      expect(loadProgress(OWNER, 84532, KEY)!.every((r) => r.status === "sent" && r.callsId === "0xbatch" && r.fromBlock === "4242")).toBe(true);
      return { status: "failure", receipts: [] };
    });
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(result.current.rows.map((r) => r.status)).toEqual(["failed", "failed", "failed"]);
    expect(result.current.error).toBe("atomic_failed");
    act(() => result.current.sendOneByOne());
    expect(result.current.mode).toBe("sequential");
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(sendCallsAsync).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("a batch still pending on resume is re-checked by its id and never sent again", async () => {
    saveProgress(OWNER, 84532, KEY, rows.map((r) => row(r, { callsId: "0xold", sentAt: Date.now(), status: "sent" })));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(waitForCallsStatus).toHaveBeenCalledWith(config, expect.objectContaining({ id: "0xold" }));
    expect(sendCallsAsync).not.toHaveBeenCalled();
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
  });
});

describe("useMultisend sequential", () => {
  it("one transfer per row, account pinned, each hash and the block before signing stored before its receipt", async () => {
    waitForTransactionReceipt.mockImplementation(async (_c: unknown, { hash }: { hash: string }) => {
      expect(loadProgress(OWNER, 84532, KEY)!.find((r) => r.hash === hash)).toMatchObject({ status: "sent", fromBlock: "4242" });
      return { status: "success" };
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
    expect(result.current.running).toBe(false);
  });

  it("C3: every confirmed line goes to the 24 h record (chain, recipient, amount, hash)", async () => {
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(recentConfirmed(84532, Date.now()).map((e) => [e.to, e.amount, e.hash])).toEqual([
      [A, "10000000", h(1)],
      [B, "12500000", h(2)],
      [C, "7500000", h(3)],
    ]);
  });

  it("the 2nd rejected: 1st confirmed with its hash stored, 2nd failed, 3rd todo, only 2 sends", async () => {
    send.mockResolvedValueOnce(h(1)).mockRejectedValueOnce(userRejected);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "failed", "todo"]);
    expect(result.current.error).toBe("cancelled");
    const stored = loadProgress(OWNER, 84532, KEY)!;
    expect(stored[0]).toMatchObject({ status: "confirmed", hash: h(1) });
    expect(stored.map((r) => r.status)).toEqual(["confirmed", "failed", "todo"]);
  });

  it("a reverted transfer stops with that row failed", async () => {
    waitForTransactionReceipt.mockResolvedValueOnce({ status: "success" }).mockResolvedValueOnce({ status: "reverted" });
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "failed", "todo"]);
    expect(result.current.error).toBe("reverted");
  });

  it("only the approved lines are signed", async () => {
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, new Set([rows[2]!.id])));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].to).toBe(C);
    expect(result.current.rows.map((r) => r.status)).toEqual(["todo", "todo", "confirmed"]);
  });

  it("Review Focus 4: resuming with the 1st sent and a success receipt does not resend it; sends the 2nd and 3rd", async () => {
    saveProgress(OWNER, 84532, KEY, [
      row(rows[0]!, { hash: h(7), sentAt: Date.now(), status: "sent" }),
      row(rows[1]!, { status: "failed" }),
      row(rows[2]!, { status: "todo" }),
    ]);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, new Set([rows[1]!.id, rows[2]!.id])));
    expect(waitForTransactionReceipt.mock.calls[0]![1]).toMatchObject({ hash: h(7), chainId: 84532 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([B, C]);
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(result.current.rows[0]!.hash).toBe(h(7));
  });

  it("C3: progress resumes for the same lines in another order", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[2]!, { status: "todo" }), row(rows[0]!, { hash: h(7), status: "confirmed" }), row(rows[1]!, { status: "todo" })]);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, new Set([rows[1]!.id, rows[2]!.id])));
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([B, C]);
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
  });

  it("a sent row whose receipt does not come yet is never resent; the approved others still go", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { hash: h(7), sentAt: Date.now(), status: "sent" }), row(rows[1]!, { status: "todo" }), row(rows[2]!, { status: "todo" })]);
    waitForTransactionReceipt.mockRejectedValueOnce(new Error("timeout"));
    const { result } = renderHook(() => useMultisend(84532));
    // Even if a caller approved it, a sent line is only re-checked.
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([B, C]);
    expect(findTransfer).not.toHaveBeenCalled();
    expect(result.current.rows[0]!.status).toBe("sent");
    expect(result.current.error).toBe("pending");
  });

  it("C1: no receipt after the give-up → the Transfer log scan finds it: confirmed with that hash, never resent", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { hash: h(7), sentAt: STALE(), fromBlock: "900", status: "sent" }), row(rows[1]!, { status: "confirmed", hash: h(8) })]
      .concat([row(rows[2]!, { status: "confirmed", hash: h(9) })]));
    waitForTransactionReceipt.mockRejectedValueOnce(new Error("timeout"));
    findTransfer.mockResolvedValueOnce(h(55));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(getPublicClient).toHaveBeenCalledWith(config, { chainId: 84532 });
    expect(findTransfer).toHaveBeenCalledWith(publicClient, {
      usdc: USDC_BASE,
      from: OWNER,
      to: A,
      amount: 10_000_000n,
      fromBlock: 900n,
      exclude: new Set([h(8), h(9)]),
    });
    expect(send).not.toHaveBeenCalled();
    expect(result.current.rows[0]).toMatchObject({ status: "confirmed", hash: h(55) });
    expect(result.current.error).toBeNull();
  });

  it("C1: nothing found → «sin confirmar», never resent even when approved, with the unconfirmed error", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { hash: h(7), sentAt: STALE(), status: "sent" }), row(rows[1]!, { status: "todo" }), row(rows[2]!, { status: "todo" })]);
    waitForTransactionReceipt.mockRejectedValueOnce(new Error("timeout"));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([B, C]);
    expect(result.current.rows[0]).toMatchObject({ status: "unconfirmed", hash: h(7) });
    expect(result.current.error).toBe("unconfirmed");
    expect(findTransfer.mock.calls[0]![1]).toMatchObject({ fromBlock: undefined });
  });

  it("C1: a failed log scan also leaves it «sin confirmar»", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { hash: h(7), sentAt: STALE(), status: "sent" }), row(rows[1]!, { status: "confirmed" }), row(rows[2]!, { status: "confirmed" })]);
    waitForTransactionReceipt.mockRejectedValueOnce(new Error("timeout"));
    findTransfer.mockRejectedValueOnce(new Error("rpc down"));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(result.current.rows[0]!.status).toBe("unconfirmed");
    expect(send).not.toHaveBeenCalled();
  });

  it("C1: an unconfirmed line is scanned again; it is resent only when released, and only if the scan still finds nothing", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { hash: h(7), sentAt: STALE(), status: "unconfirmed" }), row(rows[1]!, { status: "confirmed" }), row(rows[2]!, { status: "confirmed" })]);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, new Set()));
    expect(findTransfer).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
    await act(() => result.current.send(rows, OWNER, KEY, new Set(), new Set([rows[0]!.id])));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].to).toBe(A);
    expect(result.current.rows[0]).toMatchObject({ status: "confirmed", hash: h(1) });
  });

  it("C1: a released line the scan does find is confirmed, not resent", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { hash: h(7), sentAt: STALE(), status: "unconfirmed" }), row(rows[1]!, { status: "confirmed" }), row(rows[2]!, { status: "confirmed" })]);
    findTransfer.mockResolvedValueOnce(h(55));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, new Set(), new Set([rows[0]!.id])));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.rows[0]).toMatchObject({ status: "confirmed", hash: h(55) });
  });

  it("a sent row that turns failed on re-check (reverted) is not signed in the same run", async () => {
    saveProgress(OWNER, 84532, KEY, [row(rows[0]!, { hash: h(7), sentAt: Date.now(), status: "sent" }), row(rows[1]!, { status: "confirmed" }), row(rows[2]!, { status: "confirmed" })]);
    waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" });
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.rows[0]!.status).toBe("failed");
    expect(result.current.error).toBe("reverted");
  });

  it("progress for another list is ignored: everything starts from todo", async () => {
    saveProgress(OWNER, 84532, KEY, [{ id: "x", to: A, amount: "1", status: "confirmed" }]);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("a refused chain switch signs nothing", async () => {
    ensure.mockResolvedValue(false);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.error).toBe("switch");
  });

  it("the balance is checked against the total before signing: short USDC or no ETH signs nothing", async () => {
    readAssetBalance.mockImplementation(async (_c: unknown, asset: { token: string }) => (asset.token === "USDC" ? 29_999_999n : 10n ** 18n));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.error).toBe("insufficient");
    readAssetBalance.mockImplementation(async (_c: unknown, asset: { token: string }) => (asset.token === "USDC" ? 30_000_000n : 0n));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.error).toBe("no_gas");
    expect(readAssetBalance).toHaveBeenCalledWith(config, expect.objectContaining({ chainId: 84532, token: "USDC" }), OWNER);
  });

  it("all rows already confirmed: nothing to sign, not even a chain switch", async () => {
    saveProgress(OWNER, 84532, KEY, rows.map((r, i) => row(r, { hash: h(i + 1), status: "confirmed" })));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY, ALL));
    expect(ensure).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
  });
});
