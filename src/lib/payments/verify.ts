import "server-only";
import { erc20Abi, parseEventLogs, type PublicClient } from "viem";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import type { Token } from "@/lib/payments/amounts";
import { chainClient } from "@/lib/payments/chain-client";

export type VerifyInput = {
  chain: ChainId;
  token: Token;
  txHash: `0x${string}`;
  from: string;
  to: string;
  amount: bigint;
  notBefore: Date;
  confirmations?: number;
};

export type VerifyResult =
  | { status: "ok"; logIndex: number; blockNumber: bigint }
  | { status: "pending" }
  | { status: "error"; code: "tx_not_found" | "tx_failed" | "tx_mismatch" | "tx_too_old" | "rpc_unavailable" };

const err = (code: Extract<VerifyResult, { status: "error" }>["code"]): VerifyResult => ({ status: "error", code });
const same = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
const SKEW_SECONDS = 120n;

class NotFound extends Error {}

function isNotFound(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "TransactionNotFoundError" || name === "TransactionReceiptNotFoundError";
}

/** Checks a single transfer on-chain against what the payment intent expects. Never throws. */
export async function verifyTransfer(input: VerifyInput, client: PublicClient = chainClient(input.chain)): Promise<VerifyResult> {
  const confirmations = input.confirmations ?? Number(process.env.TIP_CONFIRMATIONS ?? 3);
  try {
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: input.txHash });
    } catch (e) {
      if (isNotFound(e)) throw new NotFound();
      throw e;
    }
    if (receipt.status !== "success") return err("tx_failed");

    const head = await client.getBlockNumber();
    if (head - receipt.blockNumber + 1n < BigInt(confirmations)) return { status: "pending" };

    let logIndex = -1;
    if (input.token === "ETH") {
      let tx;
      try {
        tx = await client.getTransaction({ hash: input.txHash });
      } catch (e) {
        if (isNotFound(e)) throw new NotFound();
        throw e;
      }
      if (!same(tx.from, input.from) || !same(tx.to, input.to) || tx.value !== input.amount) return err("tx_mismatch");
    } else {
      const usdc = NETWORKS[input.chain].usdc;
      const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs, strict: true });
      const hit = logs.find(
        (l) => same(l.address, usdc) && same(l.args.from, input.from) && same(l.args.to, input.to) && l.args.value === input.amount,
      );
      if (!hit) return err("tx_mismatch");
      logIndex = hit.logIndex;
    }

    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const notBefore = BigInt(Math.floor(input.notBefore.getTime() / 1000));
    if (block.timestamp < notBefore - SKEW_SECONDS) return err("tx_too_old");

    return { status: "ok", logIndex, blockNumber: receipt.blockNumber };
  } catch (e) {
    if (e instanceof NotFound) return err("tx_not_found");
    return err("rpc_unavailable");
  }
}
