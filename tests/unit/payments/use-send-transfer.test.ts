import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendTransactionAsync = vi.fn();
const writeContractAsync = vi.fn();
const getBytecode = vi.fn();
vi.mock("wagmi/actions", () => ({ getBytecode: (...a: unknown[]) => getBytecode(...a) }));
vi.mock("wagmi", () => ({
  useConfig: () => ({ fake: "config" }),
  useSendTransaction: () => ({ sendTransactionAsync }),
  useWriteContract: () => ({ writeContractAsync }),
}));

import { useSendTransfer } from "@/lib/payments/use-send-transfer";
import { NETWORKS } from "@/lib/economy/networks";

const TO = "0x3333333333333333333333333333333333333333" as const;
const HASH = `0x${"ab".repeat(32)}` as const;

beforeEach(() => {
  sendTransactionAsync.mockReset().mockResolvedValue(HASH);
  writeContractAsync.mockReset().mockResolvedValue(HASH);
  getBytecode.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("NEXT_PUBLIC_BASE_BUILDER_CODE", "bc_test");
});
const SUFFIX = "0x62635f7465737407" + "00" + "80218021802180218021802180218021";

describe("useSendTransfer", () => {
  it("sends ETH as a plain native transfer on the chain", async () => {
    const { result } = renderHook(() => useSendTransfer());
    await expect(result.current.send({ chain: 421614, token: "ETH", to: TO, amount: 10n ** 15n })).resolves.toBe(HASH);
    expect(sendTransactionAsync).toHaveBeenCalledWith({ to: TO, value: 10n ** 15n, chainId: 421614 });
    expect(getBytecode).not.toHaveBeenCalled();
    expect(writeContractAsync).not.toHaveBeenCalled();
  });

  it("sends USDC as ERC-20 transfer on the chain's official contract", async () => {
    const { result } = renderHook(() => useSendTransfer());
    await result.current.send({ chain: 8453, token: "USDC", to: TO, amount: 12_500_000n });
    const arg = writeContractAsync.mock.calls[0]![0];
    expect(arg).toMatchObject({ address: NETWORKS[8453].usdc, functionName: "transfer", args: [TO, 12_500_000n], chainId: 8453 });
    expect(sendTransactionAsync).not.toHaveBeenCalled();
  });

  it("appends the builder suffix to USDC on Base chains only", async () => {
    const { result } = renderHook(() => useSendTransfer());
    await result.current.send({ chain: 84532, token: "USDC", to: TO, amount: 1n });
    expect(writeContractAsync.mock.calls[0]![0].dataSuffix).toBe(SUFFIX);
    await result.current.send({ chain: 421614, token: "USDC", to: TO, amount: 1n });
    expect(writeContractAsync.mock.calls[1]![0]).not.toHaveProperty("dataSuffix");
  });

  it("appends the suffix as data on ETH to an EOA", async () => {
    const { result } = renderHook(() => useSendTransfer());
    await result.current.send({ chain: 84532, token: "ETH", to: TO, amount: 5n });
    expect(getBytecode).toHaveBeenCalledWith({ fake: "config" }, { address: TO, chainId: 84532 });
    expect(sendTransactionAsync).toHaveBeenCalledWith({ to: TO, value: 5n, chainId: 84532, data: SUFFIX });
  });

  it("sends ETH without data to a contract or when the code read fails", async () => {
    const { result } = renderHook(() => useSendTransfer());
    getBytecode.mockResolvedValue("0x6080");
    await result.current.send({ chain: 84532, token: "ETH", to: TO, amount: 5n });
    expect(sendTransactionAsync.mock.calls[0]![0]).not.toHaveProperty("data");
    getBytecode.mockRejectedValue(new Error("rpc"));
    await result.current.send({ chain: 84532, token: "ETH", to: TO, amount: 5n });
    expect(sendTransactionAsync.mock.calls[1]![0]).not.toHaveProperty("data");
  });

  it("propagates a rejection", async () => {
    sendTransactionAsync.mockRejectedValue(new Error("User rejected"));
    const { result } = renderHook(() => useSendTransfer());
    await expect(result.current.send({ chain: 84532, token: "ETH", to: TO, amount: 1n })).rejects.toThrow("User rejected");
  });
});
