import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendTransactionAsync = vi.fn();
const writeContractAsync = vi.fn();
vi.mock("wagmi", () => ({
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
});

describe("useSendTransfer", () => {
  it("sends ETH as a plain native transfer on the chain", async () => {
    const { result } = renderHook(() => useSendTransfer());
    await expect(result.current.send({ chain: 84532, token: "ETH", to: TO, amount: 10n ** 15n })).resolves.toBe(HASH);
    expect(sendTransactionAsync).toHaveBeenCalledWith({ to: TO, value: 10n ** 15n, chainId: 84532 });
    expect(writeContractAsync).not.toHaveBeenCalled();
  });

  it("sends USDC as ERC-20 transfer on the chain's official contract", async () => {
    const { result } = renderHook(() => useSendTransfer());
    await result.current.send({ chain: 8453, token: "USDC", to: TO, amount: 12_500_000n });
    const arg = writeContractAsync.mock.calls[0]![0];
    expect(arg).toMatchObject({ address: NETWORKS[8453].usdc, functionName: "transfer", args: [TO, 12_500_000n], chainId: 8453 });
    expect(sendTransactionAsync).not.toHaveBeenCalled();
  });

  it("propagates a rejection", async () => {
    sendTransactionAsync.mockRejectedValue(new Error("User rejected"));
    const { result } = renderHook(() => useSendTransfer());
    await expect(result.current.send({ chain: 84532, token: "ETH", to: TO, amount: 1n })).rejects.toThrow("User rejected");
  });
});
