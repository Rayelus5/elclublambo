"use client";

import { useCallback } from "react";
import { erc20Abi } from "viem";
import { useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import type { ChainId } from "@/lib/economy/networks";
import { useEnsureChain } from "@/lib/payments/use-ensure-chain";
import { CHAIN_SWITCH_FAILED } from "@/lib/vouches/use-vouch-write";
import { dataSuffixFor } from "@/lib/web3/builder-code";

type Hash = `0x${string}`;

/** Thrown (as the error message) when the revoke was mined but reverted: the allowance is unchanged. */
export const TX_REVERTED = "tx_reverted";

export type RevokeInput = { chainId: ChainId; token: Hash; spender: Hash; account: Hash };

/**
 * Revokes an ERC-20 allowance (P6-R2d): `approve(spender, 0)` on the token, signed by `account` (pinned, so an account
 * changed during the switch prompt is refused by wagmi) on the lookup's chain, after moving the wallet there; with the
 * Builder Code suffix on Base only (D14). `onSent` gets the hash as soon as the wallet returns it (to persist it), and
 * the promise resolves to it once the receipt is in. A refused switch throws CHAIN_SWITCH_FAILED and signs nothing.
 */
export function useRevoke(): { revoke(input: RevokeInput, onSent?: (hash: Hash) => void): Promise<Hash>; switching: boolean } {
  const config = useConfig();
  const { ensure, switching } = useEnsureChain();
  const { writeContractAsync } = useWriteContract();

  const revoke = useCallback(
    async ({ chainId, token, spender, account }: RevokeInput, onSent?: (hash: Hash) => void) => {
      if (!(await ensure(chainId))) throw new Error(CHAIN_SWITCH_FAILED);
      const suffix = dataSuffixFor(chainId);
      const hash = await writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, 0n],
        chainId,
        account,
        ...(suffix ? { dataSuffix: suffix } : {}),
      });
      onSent?.(hash);
      const receipt = await waitForTransactionReceipt(config, { hash, chainId });
      if (receipt.status !== "success") throw new Error(TX_REVERTED);
      return hash;
    },
    [config, ensure, writeContractAsync],
  );
  return { revoke, switching };
}
