import "server-only";
import { erc20Abi, parseEventLogs, type PublicClient } from "viem";
import { isChainId, NETWORKS, type ChainId } from "@/lib/economy/networks";
import type { LegacyChainId } from "@/lib/legacy/linea";
import { legacyChainClient } from "@/lib/legacy/linea-client";
import type { Token } from "@/lib/payments/amounts";
import { chainClient } from "@/lib/payments/chain-client";
import { addressesFor } from "@/lib/treasury/valuation";

/** WETH only pays raffle prizes (F4d); tips and donations stay ETH / USDC. */
export type VerifyToken = Token | "WETH";

export type VerifyInput = {
  /** A legacy chain (59144/59141) only for the legacy islands (DAO payouts, raffle prizes; P0-R2). */
  chain: ChainId | LegacyChainId;
  token: VerifyToken;
  txHash: `0x${string}`;
  from: string;
  /** `null` (ERC-20 only, club expenses): any recipient. The sender and the exact value still have to match. */
  to: string | null;
  amount: bigint;
  notBefore: Date;
  confirmations?: number;
  /**
   * ERC-20 only (withdrawal and prize payouts): accept the first Transfer log, in log order, that pays at least
   * `amount` (the payer may round up). Without it the value must match exactly. Native ETH is always exact.
   */
  atLeast?: boolean;
  /** ERC-20 only: when this log qualifies it wins over earlier qualifying logs (a linked candidate's log). */
  preferLogIndex?: number;
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
/** TIP_CONFIRMATIONS if it is an integer >= 1, else the network's (P0-R9; 3 on the legacy chains). A bad value is logged once. */
export function defaultConfirmations(chain: ChainId | LegacyChainId): number {
  const fallback = isChainId(chain) ? NETWORKS[chain].finality.tipConfirmations : 3;
  const raw = process.env.TIP_CONFIRMATIONS;
  if (raw === undefined) return fallback;
  const n = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (Number.isSafeInteger(n) && n >= 1) return n;
  if (!warnedConfirmations) {
    warnedConfirmations = true;
    console.error(`[payments] invalid TIP_CONFIRMATIONS=${JSON.stringify(raw)}, using the network's default`);
  }
  return fallback;
}

const defaultClient = (c: ChainId | LegacyChainId): PublicClient => (isChainId(c) ? chainClient(c) : legacyChainClient(c));

function isNotFound(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "TransactionNotFoundError" || name === "TransactionReceiptNotFoundError";
}

/** Checks a single transfer on-chain against what the payment intent expects. Never throws. */
export async function verifyTransfer(input: VerifyInput, client: PublicClient = defaultClient(input.chain)): Promise<VerifyResult> {
  const confirmations = input.confirmations ?? defaultConfirmations(input.chain);
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
      if (input.to === null) return err("tx_mismatch");
      if (!same(tx.from, input.from) || !same(tx.to, input.to) || tx.value !== input.amount) return err("tx_mismatch");
      value = tx.value;
    } else {
      // The official token contract. New chains: USDC from NETWORKS, and no WETH (a WETH payout never matches). Legacy
      // chains: addressesFor, i.e. the canonical USDC / WETH, or the local chain's WETH mock through WETH_ADDRESS_59141
      // (testnet only, F4a-R10).
      const chain = input.chain;
      const contract = isChainId(chain)
        ? input.token === "USDC" ? NETWORKS[chain].usdc : null
        : input.token === "USDC" ? addressesFor(chain).usdc : addressesFor(chain).weth;
      if (!contract) return err("tx_mismatch");
      const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs, strict: true }).sort(
        (a, b) => a.logIndex - b.logIndex,
      );
      const pays = (v: bigint) => (input.atLeast ? v >= input.amount : v === input.amount);
      const qualifying = logs.filter(
        (l) => same(l.address, contract) && same(l.args.from, input.from) && (input.to === null || same(l.args.to, input.to)) && pays(l.args.value),
      );
      const hit = qualifying.find((l) => l.logIndex === input.preferLogIndex) ?? qualifying[0];
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
