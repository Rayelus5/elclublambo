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
const waitForTransactionReceipt = vi.hoisted(() => vi.fn());
const waitForCallsStatus = vi.hoisted(() => vi.fn());
vi.mock("wagmi/actions", () => ({ waitForTransactionReceipt, waitForCallsStatus }));
const ensure = vi.hoisted(() => vi.fn<(chainId: number) => Promise<boolean>>());
vi.mock("@/lib/payments/use-ensure-chain", () => ({ useEnsureChain: () => ({ ensure, switching: false, failedFor: null }) }));
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-send-transfer", () => ({ useSendTransfer: () => ({ send }) }));
const readAssetBalance = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/balances", () => ({ readAssetBalance }));

import { useMultisend } from "@/lib/multisend/use-multisend";
import { loadProgress, saveProgress } from "@/lib/multisend/progress";
import type { ParsedLine } from "@/lib/multisend/parse";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const A = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const B = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const C = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as const;
const USDC_BASE = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_ARB = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const SUFFIX = "0x62635f7465737407" + "00" + "80218021802180218021802180218021";
const h = (n: number) => `0x${n.toString(16).padStart(2, "0").repeat(32)}` as `0x${string}`;
const rows: ParsedLine[] = [
  { line: 1, to: A, amount: 10_000_000n },
  { line: 2, to: B, amount: 12_500_000n },
  { line: 3, to: C, amount: 7_500_000n },
];
const KEY = "list-key";
const userRejected = Object.assign(new Error("User rejected the request."), { name: "UserRejectedRequestError", code: 4001 });

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
    await act(() => result.current.send(rows, OWNER, KEY));
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
    await act(() => result.current.send(rows, OWNER, KEY));
    const calls = sendCallsAsync.mock.calls[0]![0].calls as Record<string, unknown>[];
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c).not.toHaveProperty("dataSuffix");
      expect(c.to).toBe(USDC_ARB);
    }
  });

  it("the batch id is stored before waiting; a failed batch leaves every row failed and offers one by one", async () => {
    waitForCallsStatus.mockImplementation(async () => {
      expect(loadProgress(OWNER, 84532, KEY)!.every((r) => r.status === "sent" && r.callsId === "0xbatch")).toBe(true);
      return { status: "failure", receipts: [] };
    });
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY));
    expect(result.current.rows.map((r) => r.status)).toEqual(["failed", "failed", "failed"]);
    expect(result.current.error).toBe("atomic_failed");
    act(() => result.current.sendOneByOne());
    expect(result.current.mode).toBe("sequential");
    await act(() => result.current.send(rows, OWNER, KEY));
    expect(sendCallsAsync).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("a batch still pending on resume is re-checked by its id and never sent again", async () => {
    saveProgress(OWNER, 84532, KEY, rows.map((r) => ({ to: r.to, amount: r.amount.toString(), callsId: "0xold", sentAt: Date.now(), status: "sent" })));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY));
    expect(waitForCallsStatus).toHaveBeenCalledWith(config, expect.objectContaining({ id: "0xold" }));
    expect(sendCallsAsync).not.toHaveBeenCalled();
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
  });
});

describe("useMultisend sequential", () => {
  it("one transfer per row, account pinned, each hash stored before its receipt", async () => {
    waitForTransactionReceipt.mockImplementation(async (_c: unknown, { hash }: { hash: string }) => {
      expect(loadProgress(OWNER, 84532, KEY)!.find((r) => r.hash === hash)?.status).toBe("sent");
      return { status: "success" };
    });
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY));
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

  it("the 2nd rejected: 1st confirmed with its hash stored, 2nd failed, 3rd todo, only 2 sends", async () => {
    send.mockResolvedValueOnce(h(1)).mockRejectedValueOnce(userRejected);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY));
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
    await act(() => result.current.send(rows, OWNER, KEY));
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "failed", "todo"]);
    expect(result.current.error).toBe("reverted");
  });

  it("Review Focus 4: resuming with the 1st sent and a success receipt does not resend it; sends the 2nd and 3rd", async () => {
    saveProgress(OWNER, 84532, KEY, [
      { to: A, amount: "10000000", hash: h(7), sentAt: Date.now(), status: "sent" },
      { to: B, amount: "12500000", status: "failed" },
      { to: C, amount: "7500000", status: "todo" },
    ]);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY));
    expect(waitForTransactionReceipt.mock.calls[0]![1]).toMatchObject({ hash: h(7), chainId: 84532 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([B, C]);
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(result.current.rows[0]!.hash).toBe(h(7));
  });

  it("a sent row whose receipt does not come yet is never resent: the run stops as pending", async () => {
    saveProgress(OWNER, 84532, KEY, [
      { to: A, amount: "10000000", hash: h(7), sentAt: Date.now(), status: "sent" },
      { to: B, amount: "12500000", status: "todo" },
      { to: C, amount: "7500000", status: "todo" },
    ]);
    waitForTransactionReceipt.mockRejectedValueOnce(new Error("timeout"));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.rows[0]!.status).toBe("sent");
    expect(result.current.error).toBe("pending");
  });

  it("a sent row unknown after the give-up window turns failed with not_found, so the user checks before continuing", async () => {
    saveProgress(OWNER, 84532, KEY, [
      { to: A, amount: "10000000", hash: h(7), sentAt: Date.now() - 11 * 60_000, status: "sent" },
      { to: B, amount: "12500000", status: "todo" },
      { to: C, amount: "7500000", status: "todo" },
    ]);
    waitForTransactionReceipt.mockRejectedValueOnce(new Error("timeout"));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.rows[0]).toMatchObject({ status: "failed", hash: h(7) });
    expect(result.current.error).toBe("not_found");
  });

  it("progress for another list is ignored: everything starts from todo", async () => {
    saveProgress(OWNER, 84532, KEY, [{ to: A, amount: "1", status: "confirmed" }]);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("a refused chain switch signs nothing", async () => {
    ensure.mockResolvedValue(false);
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.error).toBe("switch");
  });

  it("the balance is checked against the total before signing: short USDC or no ETH signs nothing", async () => {
    readAssetBalance.mockImplementation(async (_c: unknown, asset: { token: string }) => (asset.token === "USDC" ? 29_999_999n : 10n ** 18n));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.error).toBe("insufficient");
    readAssetBalance.mockImplementation(async (_c: unknown, asset: { token: string }) => (asset.token === "USDC" ? 30_000_000n : 0n));
    await act(() => result.current.send(rows, OWNER, KEY));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.error).toBe("no_gas");
    expect(readAssetBalance).toHaveBeenCalledWith(config, expect.objectContaining({ chainId: 84532, token: "USDC" }), OWNER);
  });

  it("all rows already confirmed: nothing to sign, not even a chain switch", async () => {
    saveProgress(OWNER, 84532, KEY, rows.map((r, i) => ({ to: r.to, amount: r.amount.toString(), hash: h(i + 1), status: "confirmed" })));
    const { result } = renderHook(() => useMultisend(84532));
    await act(() => result.current.send(rows, OWNER, KEY));
    expect(ensure).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(result.current.rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
  });
});
