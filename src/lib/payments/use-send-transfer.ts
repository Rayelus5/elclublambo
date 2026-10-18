"use client";

import { useCallback } from "react";
import { erc20Abi } from "viem";
import { useSendTransaction, useWriteContract } from "wagmi";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import type { Token } from "@/lib/payments/amounts";

export type TransferInput = { chain: ChainId; token: Token; to: `0x${string}`; amount: bigint };

/** Plain transfers signed by the member's wallet: native ETH, or USDC through ERC-20 `transfer` on the chain's contract. */
export function useSendTransfer(): { send(input: TransferInput): Promise<`0x${string}`> } {
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const send = useCallback(
    ({ chain, token, to, amount }: TransferInput) =>
      token === "ETH"
        ? sendTransactionAsync({ to, value: amount, chainId: chain })
        : writeContractAsync({ address: NETWORKS[chain].usdc, abi: erc20Abi, functionName: "transfer", args: [to, amount], chainId: chain }),
    [sendTransactionAsync, writeContractAsync],
  );
  return { send };
}
