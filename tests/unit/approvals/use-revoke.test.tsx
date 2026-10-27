import { renderHook } from "@testing-library/react";
import { erc20Abi } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeContractAsync = vi.fn();
const config = { tag: "wagmi-config" };
vi.mock("wagmi", () => ({ useWriteContract: () => ({ writeContractAsync }), useConfig: () => config }));
const waitForTransactionReceipt = vi.hoisted(() => vi.fn());
vi.mock("wagmi/actions", () => ({ waitForTransactionReceipt }));
const ensure = vi.fn<(chainId: number) => Promise<boolean>>();
let switching = false;
vi.mock("@/lib/payments/use-ensure-chain", () => ({ useEnsureChain: () => ({ ensure, switching, failedFor: null }) }));

import { useRevoke } from "@/lib/approvals/use-revoke";

const TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const SPENDER = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const ME = "0x1111111111111111111111111111111111111111" as const;
const HASH = `0x${"cd".repeat(32)}` as const;
const SUFFIX = "0x62635f7465737407" + "00" + "80218021802180218021802180218021";

beforeEach(() => {
  writeContractAsync.mockReset().mockResolvedValue(HASH);
  waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "success" });
  ensure.mockReset().mockResolvedValue(true);
  switching = false;
  vi.stubEnv("NEXT_PUBLIC_BASE_BUILDER_CODE", "bc_test");
});

describe("useRevoke", () => {
  it("on Base: switches first, signs approve(spender, 0) with the account and the builder suffix, then waits for the receipt", async () => {
    const onSent = vi.fn();
    const { result } = renderHook(() => useRevoke());
    await expect(result.current.revoke({ chainId: 84532, token: TOKEN, spender: SPENDER, account: ME }, onSent)).resolves.toBe(HASH);
    expect(ensure).toHaveBeenCalledWith(84532);
    expect(ensure.mock.invocationCallOrder[0]!).toBeLessThan(writeContractAsync.mock.invocationCallOrder[0]!);
    expect(writeContractAsync).toHaveBeenCalledWith({
      address: TOKEN,
      abi: erc20Abi,
      functionName: "approve",
      args: [SPENDER, 0n],
      chainId: 84532,
      account: ME,
      dataSuffix: SUFFIX,
    });
    expect(onSent).toHaveBeenCalledWith(HASH);
    expect(waitForTransactionReceipt).toHaveBeenCalledWith(config, { hash: HASH, chainId: 84532 });
    expect(onSent.mock.invocationCallOrder[0]!).toBeLessThan(waitForTransactionReceipt.mock.invocationCallOrder[0]!);
  });

  it("on Arbitrum: no dataSuffix", async () => {
    const { result } = renderHook(() => useRevoke());
    await result.current.revoke({ chainId: 421614, token: TOKEN, spender: SPENDER, account: ME });
    expect(ensure).toHaveBeenCalledWith(421614);
    expect(writeContractAsync.mock.calls[0]![0]).not.toHaveProperty("dataSuffix");
    expect(writeContractAsync.mock.calls[0]![0]).toMatchObject({ args: [SPENDER, 0n], chainId: 421614, account: ME });
  });

  it("does not sign when the chain switch fails", async () => {
    ensure.mockResolvedValue(false);
    const { result } = renderHook(() => useRevoke());
    await expect(result.current.revoke({ chainId: 84532, token: TOKEN, spender: SPENDER, account: ME })).rejects.toThrow("chain_switch_failed");
    expect(writeContractAsync).not.toHaveBeenCalled();
  });

  it("a reverted receipt rejects; switching is exposed", async () => {
    switching = true;
    waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });
    const { result } = renderHook(() => useRevoke());
    expect(result.current.switching).toBe(true);
    await expect(result.current.revoke({ chainId: 84532, token: TOKEN, spender: SPENDER, account: ME })).rejects.toThrow("tx_reverted");
  });
});
