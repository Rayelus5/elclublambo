import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Opts = { onError?: (e: Error) => void; onSuccess?: () => void };
const switchChain = vi.fn<(args: { chainId: number }, opts?: Opts) => void>();
let account: { isConnected: boolean; chainId: number | undefined } = { isConnected: true, chainId: 84532 };
vi.mock("wagmi", () => ({
  useAccount: () => account,
  useSwitchChain: () => ({ switchChain, isPending: false }),
}));

import { useEnsureChain } from "@/lib/payments/use-ensure-chain";

beforeEach(() => {
  switchChain.mockReset();
  account = { isConnected: true, chainId: 84532 };
});

describe("useEnsureChain", () => {
  it("switches the wallet when it is on another chain", () => {
    const { result } = renderHook(() => useEnsureChain());
    act(() => result.current.ensure(421614));
    expect(switchChain).toHaveBeenCalledWith({ chainId: 421614 }, expect.anything());
  });

  it("does nothing when the wallet is already there or not connected", () => {
    account = { isConnected: true, chainId: 421614 };
    const { result, rerender } = renderHook(() => useEnsureChain());
    act(() => result.current.ensure(421614));
    account = { isConnected: false, chainId: undefined };
    rerender();
    act(() => result.current.ensure(421614));
    expect(switchChain).not.toHaveBeenCalled();
  });

  it("records the chain whose switch failed, and clears it on a later success", () => {
    switchChain.mockImplementationOnce((_a, o) => o?.onError?.(new Error("rejected")));
    const { result } = renderHook(() => useEnsureChain());
    expect(result.current.failedFor).toBeNull();
    act(() => result.current.ensure(421614));
    expect(result.current.failedFor).toBe(421614);
    switchChain.mockImplementationOnce((_a, o) => o?.onSuccess?.());
    act(() => result.current.ensure(421614));
    expect(result.current.failedFor).toBeNull();
    expect(result.current.switching).toBe(false);
  });
});
