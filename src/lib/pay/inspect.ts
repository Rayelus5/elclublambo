import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { erc20Abi, parseEventLogs, type PublicClient } from "viem";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { defaultConfirmations } from "@/lib/payments/verify";

export type InspectResult =
  | {
      status: "ok";
      /** Mined with at least the network's confirmations. Only then may the page claim the payment is verified. */
      final: boolean;
      confirmations: number;
      token: "ETH" | "USDC";
      from: string;
      to: string;
      amount: bigint;
      /** Unix seconds. */
      blockTimestamp: number;
    }
  | { status: "pending" }
  | { status: "error"; code: "tx_not_found" | "tx_failed" | "not_a_payment" | "rpc_unavailable" };

const err = (code: Extract<InspectResult, { status: "error" }>["code"]): InspectResult => ({ status: "error", code });
const same = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

class NotFound extends Error {}

function isNotFound(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "TransactionNotFoundError" || name === "TransactionReceiptNotFoundError";
}

/**
 * Reads a transaction and decodes it as a payment (P3-R2, stateless): a native transfer (`tx.value > 0` and no official
 * USDC log) or the FIRST Transfer log, in log order, of the network's official USDC contract (several USDC logs: the first
 * one wins). Anything else is `not_a_payment`. Never throws.
 */
export async function inspectTransfer(chain: ChainId, hash: `0x${string}`, client: PublicClient = chainClient(chain)): Promise<InspectResult> {
  try {
    const rpcChain = await client.getChainId();
    if (rpcChain !== chain) {
      console.error(`[pay] RPC chain mismatch: expected ${chain}, got ${rpcChain}`);
      return err("rpc_unavailable");
    }

    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash });
    } catch (e) {
      if (!isNotFound(e)) throw e;
      // Broadcast but not mined yet: pending. Unknown to the node: not found.
      try {
        await client.getTransaction({ hash });
      } catch (e2) {
        if (isNotFound(e2)) throw new NotFound();
        throw e2;
      }
      return { status: "pending" };
    }
    if (receipt.status !== "success") return err("tx_failed");

    let tx;
    try {
      tx = await client.getTransaction({ hash });
    } catch (e) {
      if (isNotFound(e)) throw new NotFound();
      throw e;
    }
    if (tx.chainId !== undefined && tx.chainId !== chain) return err("not_a_payment");

    const usdc = NETWORKS[chain].usdc;
    const first = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs, strict: true })
      .filter((l) => same(l.address, usdc))
      .sort((a, b) => a.logIndex - b.logIndex)[0];

    let token: "ETH" | "USDC";
    let from: string;
    let to: string;
    let amount: bigint;
    if (first) {
      token = "USDC";
      from = first.args.from;
      to = first.args.to;
      amount = first.args.value;
    } else if (tx.value > 0n && tx.to) {
      token = "ETH";
      from = tx.from;
      to = tx.to;
      amount = tx.value;
    } else {
      return err("not_a_payment");
    }

    const head = await client.getBlockNumber();
    const confirmations = Number(head - receipt.blockNumber + 1n);
    const block = await client.getBlock({ blockHash: receipt.blockHash });
    return {
      status: "ok",
      final: confirmations >= defaultConfirmations(chain),
      confirmations: Math.max(confirmations, 0),
      token,
      from,
      to,
      amount,
      blockTimestamp: Number(block.timestamp),
    };
  } catch (e) {
    if (e instanceof NotFound) return err("tx_not_found");
    return err("rpc_unavailable");
  }
}

class NotFinal extends Error {}

/** Only a FINAL payment is cached (the chain no longer changes it); anything else throws so nothing is stored. */
async function readFinal(chain: ChainId, hash: `0x${string}`): Promise<Extract<InspectResult, { status: "ok" }>> {
  "use cache";
  cacheLife("max");
  cacheTag(`pay-receipt:${chain}:${hash}`);
  const r = await inspectTransfer(chain, hash);
  if (r.status !== "ok" || !r.final) throw new NotFinal();
  return r;
}

/**
 * The receipt's data. One uncached inspection first: a pending, non-final or error view costs a single inspection and
 * stores nothing. Only a FINAL payment goes through the cached read (one extra read on its first final view), and the
 * hash is lowercased so a transaction has a single cache entry.
 */
export async function readReceipt(chain: ChainId, hash: `0x${string}`): Promise<InspectResult> {
  const h = hash.toLowerCase() as `0x${string}`;
  const fresh = await inspectTransfer(chain, h);
  if (fresh.status !== "ok" || !fresh.final) return fresh;
  try {
    return await readFinal(chain, h);
  } catch {
    return fresh;
  }
}
