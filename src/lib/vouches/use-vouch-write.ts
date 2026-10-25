"use client";

import { useCallback } from "react";
import { useWriteContract } from "wagmi";
import { useEnsureChain } from "@/lib/payments/use-ensure-chain";
import { dataSuffixFor } from "@/lib/web3/builder-code";
import { attestArgs, easAddresses, revokeArgs, vouchChain } from "./eas";
import { easAbi } from "./eas-abi";
import type { VouchKind } from "./kinds";

/** Thrown (as the error message) when the wallet did not move to Base: nothing was signed. */
export const CHAIN_SWITCH_FAILED = "chain_switch_failed";

/**
 * The user's wallet signs EAS attest/revoke on this deployment's Base (P5-R4), after switching to it, with the Builder
 * Code suffix when one is configured (D14). Resolves to the transaction hash; the caller sends it to the server action.
 */
export function useVouchWrite(): {
  attest(recipient: `0x${string}`, kind: VouchKind): Promise<`0x${string}`>;
  revoke(uid: `0x${string}`): Promise<`0x${string}`>;
  switching: boolean;
} {
  const { ensure, switching } = useEnsureChain();
  const { writeContractAsync } = useWriteContract();

  const target = useCallback(async () => {
    const chain = vouchChain();
    if (!(await ensure(chain))) throw new Error(CHAIN_SWITCH_FAILED);
    const suffix = dataSuffixFor(chain);
    return { address: easAddresses().eas, abi: easAbi, chainId: chain, ...(suffix ? { dataSuffix: suffix } : {}) };
  }, [ensure]);

  const attest = useCallback(
    async (recipient: `0x${string}`, kind: VouchKind) => writeContractAsync({ ...(await target()), functionName: "attest", args: attestArgs(recipient, kind) }),
    [target, writeContractAsync],
  );
  const revoke = useCallback(
    async (uid: `0x${string}`) => writeContractAsync({ ...(await target()), functionName: "revoke", args: revokeArgs(uid) }),
    [target, writeContractAsync],
  );
  return { attest, revoke, switching };
}
