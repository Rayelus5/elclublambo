"use client";

import { useCallback } from "react";
import { erc20Abi } from "viem";
import { useSendTransaction, useWriteContract } from "wagmi";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import type { Token } from "@/lib/payments/amounts";

/** `account` pins the signer: wagmi refuses to send from a different connected account. */
export type TransferInput = { chain: ChainId; token: Token; to: `0x${string}`; amount: bigint; account?: `0x${string}` };

/** Plain transfers signed by the member's wallet: native ETH, or USDC through ERC-20 `transfer` on the chain's contract. */
export function useSendTransfer(): { send(input: TransferInput): Promise<`0x${string}`> } {
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const send = useCallback(
    ({ chain, token, to, amount, account }: TransferInput) =>
      token === "ETH"
        ? sendTransactionAsync({ to, value: amount, chainId: chain, ...(account ? { account } : {}) })
        : writeContractAsync({
            address: NETWORKS[chain].usdc,
            abi: erc20Abi,
            functionName: "transfer",
            args: [to, amount],
            chainId: chain,
            ...(account ? { account } : {}),
          }),
    [sendTransactionAsync, writeContractAsync],
  );
  return { send };
}
