"use server";

import { clubPath } from "@/lib/club/paths";
import { revalidatePath } from "next/cache";
import { appChainIds, isChainId, type ChainId } from "@/lib/economy/networks";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { parseAmount } from "@/lib/payments/amounts";
import { chainClient } from "@/lib/payments/chain-client";
import { defaultConfirmations, verifyTransfer } from "@/lib/payments/verify";
import { hitRateLimit } from "@/lib/rate-limit";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { treasurerId } from "@/lib/treasury/treasurer";

type Fail = { ok: false; error: string; code: string };
const fail = (code: string): Fail => ({ ok: false, code, error: rpcErrorMessage(code) });

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const NOTE_MAX = 280;

export type ExpenseInput = { chainId: number; token: "USDC" | "ETH"; amount: string; txHash: string; note: string };

type Found = { logIndex: number; kind: "usdc_log" | "safe_tx" };

function isNotFound(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "TransactionNotFoundError" || name === "TransactionReceiptNotFoundError";
}

/**
 * ETH leaves a Safe through an execTransaction, which is an internal transfer verifyTransfer cannot see (P1-R7): the
 * receipt has to be a success with enough confirmations and the transaction has to go to the Safe. The amount is the
 * one the treasurer declared; the explorer link lets anyone check it.
 */
async function verifySafeExecution(chain: ChainId, hash: `0x${string}`, safe: string): Promise<Found | Fail> {
  try {
    const client = chainClient(chain);
    if ((await client.getChainId()) !== chain) return fail("rpc_unavailable");
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt.status !== "success") return fail("tx_failed");
    const head = await client.getBlockNumber();
    if (head - receipt.blockNumber + 1n < BigInt(defaultConfirmations(chain))) return fail("payout_pending");
    const tx = await client.getTransaction({ hash });
    if (tx.chainId !== undefined && tx.chainId !== chain) return fail("tx_mismatch");
    if (!tx.to || tx.to.toLowerCase() !== safe.toLowerCase()) return fail("tx_mismatch");
    return { logIndex: -1, kind: "safe_tx" };
  } catch (e) {
    if (isNotFound(e)) return fail("tx_not_found");
    console.error("[expenses] ETH verification failed", chain, safeError(e));
    return fail("rpc_unavailable");
  }
}

/**
 * A treasurer notes an outgoing transfer of the club Safe (D9, P1-R7). USDC: a Transfer log of the network's USDC from
 * the Safe for the exact amount, to any recipient. ETH: a successful transaction to the Safe. Only then the RPC records it.
 */
export async function addExpenseAction(input: ExpenseInput): Promise<{ ok: true } | Fail> {
  const { chainId, token, amount, txHash, note } = input ?? ({} as ExpenseInput);
  if (
    !isChainId(chainId) ||
    (token !== "ETH" && token !== "USDC") ||
    typeof amount !== "string" ||
    typeof txHash !== "string" ||
    !HASH_RE.test(txHash) ||
    typeof note !== "string"
  ) {
    return fail("invalid_input");
  }
  if (!appChainIds().includes(chainId)) return fail("chain_invalid");
  const units = parseAmount(amount, token);
  const text = note.trim();
  if (units === null || units <= 0n || text.length < 1 || text.length > NOTE_MAX) return fail("invalid_input");

  const actor = await treasurerId();
  if (!actor) return fail("forbidden");

  const limit = await hitRateLimit(await createServerClient(), "chain_verify");
  if (limit === "rate_limited") return fail("rate_limited");
  if (limit !== "ok") return fail("unknown");

  const admin = createAdminClient();
  const { data: chainRow, error: chainErr } = await admin.from("chains").select("safe_address").eq("chain_id", chainId).maybeSingle<{ safe_address: string | null }>();
  if (chainErr) {
    console.error("[expenses] chains read failed", chainId, safeError(chainErr.message));
    return fail("unknown");
  }
  const safe = chainRow?.safe_address;
  if (!safe) return fail("safe_not_configured");

  const hash = txHash.toLowerCase() as `0x${string}`;
  let found: Found | Fail;
  if (token === "USDC") {
    const r = await verifyTransfer({ chain: chainId, token: "USDC", txHash: hash, from: safe, to: null, amount: units, notBefore: new Date(0) });
    if (r.status === "pending") return fail("payout_pending");
    if (r.status === "error") return fail(r.code);
    found = { logIndex: r.logIndex, kind: "usdc_log" };
  } else {
    found = await verifySafeExecution(chainId, hash, safe);
  }
  if ("ok" in found) return found;

  const { error } = await admin.rpc("record_club_expense", {
    p_chain: chainId,
    p_token: token,
    p_amount: units.toString(),
    p_tx_hash: hash,
    p_log_index: found.logIndex,
    p_note: text,
    p_verified_kind: found.kind,
    p_actor: actor,
  });
  if (error) return fail(rpcErrorCode(error));
  revalidatePath("/donar");
  revalidatePath(clubPath("/donar"));
  return { ok: true };
}
