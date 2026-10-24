"use client";

import { useCallback } from "react";
import { erc20Abi } from "viem";
import { useConfig, useSendTransaction, useWriteContract } from "wagmi";
import { getBytecode } from "wagmi/actions";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import type { Token } from "@/lib/payments/amounts";
import { dataSuffixFor } from "@/lib/web3/builder-code";

/** `account` pins the signer: wagmi refuses to send from a different connected account. */
export type TransferInput = { chain: ChainId; token: Token; to: `0x${string}`; amount: bigint; account?: `0x${string}` };

/** Plain transfers signed by the member's wallet: native ETH, or USDC through ERC-20 `transfer` on the chain's contract. */
export function useSendTransfer(): { send(input: TransferInput): Promise<`0x${string}`> } {
  const config = useConfig();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const send = useCallback(
    async ({ chain, token, to, amount, account }: TransferInput) => {
      const signer = account ? { account } : {};
      const suffix = dataSuffixFor(chain);
      if (token === "USDC") {
        // ERC-20 `transfer` ignores calldata bytes past its arguments, so the attribution suffix is safe.
        return writeContractAsync({
          address: NETWORKS[chain].usdc,
          abi: erc20Abi,
          functionName: "transfer",
          args: [to, amount],
          chainId: chain,
          ...(suffix ? { dataSuffix: suffix } : {}),
          ...signer,
        });
      }
      // Only a code-less recipient is safe to send data to: a contract's fallback could revert on it.
      let data: `0x${string}` | undefined;
      if (suffix) {
        try {
          const code = await getBytecode(config, { address: to, chainId: chain });
          if (code === undefined || code === "0x") data = suffix;
        } catch {
          // Unknown recipient code: send a plain transfer.
        }
      }
      return sendTransactionAsync({ to, value: amount, chainId: chain, ...(data ? { data } : {}), ...signer });
    },
    [config, sendTransactionAsync, writeContractAsync],
  );
  return { send };
}
