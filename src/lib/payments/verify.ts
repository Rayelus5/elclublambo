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
  /**
   * USDC only (withdrawal payouts): accept the first Transfer log, in log order, that pays at least `amount` (the payer
   * may round up). Without it the value must match exactly. Native ETH is always exact.
   */
  atLeast?: boolean;
};

export type VerifyResult =
  | { status: "ok"; logIndex: number; /** The matched log's value (tx.value for ETH). */ value: bigint; blockNumber: bigint; blockTimestamp: Date }
  | { status: "pending" }
  | { status: "error"; code: "tx_not_found" | "tx_failed" | "tx_mismatch" | "tx_too_old" | "rpc_unavailable" };

const err = (code: Extract<VerifyResult, { status: "error" }>["code"]): VerifyResult => ({ status: "error", code });
const same = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
const SKEW_SECONDS = 120n;

class NotFound extends Error {}

let warnedConfirmations = false;
/** TIP_CONFIRMATIONS if it is an integer >= 1, else 3 (a bad value is logged once). */
export function defaultConfirmations(): number {
  const raw = process.env.TIP_CONFIRMATIONS;
  if (raw === undefined) return 3;
  const n = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (Number.isSafeInteger(n) && n >= 1) return n;
  if (!warnedConfirmations) {
    warnedConfirmations = true;
    console.error(`[payments] invalid TIP_CONFIRMATIONS=${JSON.stringify(raw)}, using 3`);
  }
  return 3;
}

function isNotFound(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "TransactionNotFoundError" || name === "TransactionReceiptNotFoundError";
}

/** Checks a single transfer on-chain against what the payment intent expects. Never throws. */
export async function verifyTransfer(input: VerifyInput, client: PublicClient = chainClient(input.chain)): Promise<VerifyResult> {
  const confirmations = input.confirmations ?? defaultConfirmations();
  try {
    const rpcChain = await client.getChainId();
    if (rpcChain !== input.chain) {
      console.error(`[payments] RPC chain mismatch: expected ${input.chain}, got ${rpcChain}`);
      return err("rpc_unavailable");
    }

    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: input.txHash });
    } catch (e) {
      if (!isNotFound(e)) throw e;
      // Broadcast but not mined yet: pending. Unknown to the node: not found.
      try {
        await client.getTransaction({ hash: input.txHash });
      } catch (e2) {
        if (isNotFound(e2)) throw new NotFound();
        throw e2;
      }
      return { status: "pending" };
    }
    if (receipt.status !== "success") return err("tx_failed");

    const head = await client.getBlockNumber();
    if (head - receipt.blockNumber + 1n < BigInt(confirmations)) return { status: "pending" };

    let tx;
    try {
      tx = await client.getTransaction({ hash: input.txHash });
    } catch (e) {
      if (isNotFound(e)) throw new NotFound();
      throw e;
    }
    if (tx.chainId !== undefined && tx.chainId !== input.chain) return err("tx_mismatch");

    let logIndex = -1;
    let value: bigint;
    if (input.token === "ETH") {
      if (!same(tx.from, input.from) || !same(tx.to, input.to) || tx.value !== input.amount) return err("tx_mismatch");
      value = tx.value;
    } else {
      const usdc = NETWORKS[input.chain].usdc;
      const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs, strict: true }).sort(
        (a, b) => a.logIndex - b.logIndex,
      );
      const pays = (v: bigint) => (input.atLeast ? v >= input.amount : v === input.amount);
      const hit = logs.find((l) => same(l.address, usdc) && same(l.args.from, input.from) && same(l.args.to, input.to) && pays(l.args.value));
      if (!hit) return err("tx_mismatch");
      logIndex = hit.logIndex;
      value = hit.args.value;
    }

    const block = await client.getBlock({ blockHash: receipt.blockHash });
    const notBefore = BigInt(Math.floor(input.notBefore.getTime() / 1000));
    if (block.timestamp < notBefore - SKEW_SECONDS) return err("tx_too_old");

    return { status: "ok", logIndex, value, blockNumber: receipt.blockNumber, blockTimestamp: new Date(Number(block.timestamp) * 1000) };
  } catch (e) {
    if (e instanceof NotFound) return err("tx_not_found");
    return err("rpc_unavailable");
  }
}
