"use server";

import { safeError } from "@/lib/security/redact";
import { revalidatePath } from "next/cache";
import { isChainId, type ChainId } from "@/lib/economy/networks";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { payoutPayload, verifyPayout } from "@/lib/treasury/payouts";
import { scanSafeOperations } from "@/lib/treasury/scan";
import { safeAddressOf, valuationCap, valueSafe, type SafeValuation } from "@/lib/treasury/snapshot";
import { treasurerId } from "@/lib/treasury/treasurer";

type Fail = { ok: false; error: string; code: string };
const fail = (code: string): Fail => ({ ok: false, code, error: rpcErrorMessage(code) });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
/** A positive integer number of shares (numeric(78,0)), no leading zeros, signs or exponents. */
const SHARES = /^[1-9]\d{0,77}$/;

const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

function revalidate() {
  revalidatePath("/dao");
  revalidatePath("/dao/tesoreria");
}

type Db = ReturnType<typeof createAdminClient>;
type RequestRow = {
  chain_id: number;
  member_id: string;
  status: string;
  destination_address: string | null;
  amount_usdc_locked: string | null;
  approved_at: string | null;
  last_expired_at: string | null;
};

/** The request, or a Fail: not_found, or unknown on a read error (never a throw out of the action). */
async function readRequest(db: Db, id: string): Promise<RequestRow | Fail> {
  const { data, error } = await db
    .from("withdrawal_requests")
    .select("chain_id, member_id, status, destination_address, amount_usdc_locked:amount_usdc_locked::text, approved_at, last_expired_at")
    .eq("id", id)
    .maybeSingle<RequestRow>();
  if (error) {
    console.error("[treasury] withdrawal request read failed", id, safeError(error.message));
    return fail("unknown");
  }
  return data ?? fail("not_found");
}

const isFail = (v: object): v is Fail => (v as { ok?: unknown }).ok === false;
const DIGITS = /^\d{1,78}$/;

async function safeValuation(chain: ChainId): Promise<SafeValuation | null> {
  try {
    return await valueSafe(chain);
  } catch (e) {
    console.error("[treasury] valuation failed", chain, safeError(e));
    return null;
  }
}

/**
 * Ruling F4c-R7 (a): while withdrawals are approved and unpaid the Safe is valued at most at the scan cursor, so the
 * scan is brought up to the tip first (every payout already mined is then linked, and the read is recent). A failing
 * cap read or scan is only logged: the valuation still runs and SQL's guard decides (assets_stale).
 */
async function catchUpScan(chain: ChainId): Promise<void> {
  try {
    if ((await valuationCap(chain)).capped) await scanSafeOperations(chain);
  } catch (e) {
    console.error("[treasury] scan before valuation failed", chain, safeError(e));
  }
}

/**
 * Runs a valuation-bound service RPC: the scan caught up when needed (F4c-R7 a), a fresh Safe valuation each try,
 * `valuation_unavailable` without one, and one retry when SQL answers `assets_stale` (a donation was credited after the
 * read, or the read is past the scan cursor).
 */
async function withValuation<T>(
  chain: ChainId,
  call: (v: SafeValuation) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>,
  done: (data: unknown, v: SafeValuation) => T,
): Promise<T | Fail> {
  await catchUpScan(chain);
  for (let attempt = 0; ; attempt++) {
    const v = await safeValuation(chain);
    if (!v) return fail("valuation_unavailable");
    const { data, error } = await call(v);
    if (!error) return done(data, v);
    const code = rpcErrorCode(error);
    if (code === "assets_stale" && attempt === 0) continue;
    return fail(code);
  }
}

/** Member: asks to withdraw `shares` (an integer string of base units) on the active chain. */
export async function requestWithdrawalAction(input: { shares: string }): Promise<{ ok: true; id: string } | Fail> {
  const shares = input?.shares;
  if (typeof shares !== "string" || !SHARES.test(shares)) return fail("invalid_input");
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("request_withdrawal", { p_shares: shares });
  if (error) return fail(rpcErrorCode(error));
  if (typeof data !== "string") return fail("unknown");
  revalidate();
  return { ok: true, id: data };
}

/** Member: cancels their own pending request (the shares unlock). */
export async function cancelWithdrawalAction(id: string): Promise<{ ok: true } | Fail> {
  if (!isId(id)) return fail("invalid_input");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("cancel_withdrawal", { p_request: id });
  if (error) return fail(rpcErrorCode(error));
  revalidate();
  return { ok: true };
}

/** Treasurer: what approving now would fix, plus the Safe's USDC and what is left after approved, unpaid requests. */
export async function quoteWithdrawalAction(id: string): Promise<
  | {
      ok: true;
      quote: { amountUsdc: string; safeUsdc: string; availableUsdc: string; destination: string; selfApproval: boolean };
    }
  | Fail
> {
  if (!isId(id)) return fail("invalid_input");
  const me = await treasurerId();
  if (!me) return fail("forbidden");

  const db = createAdminClient();
  const req = await readRequest(db, id);
  if (isFail(req)) return req;
  if (!isChainId(req.chain_id)) return fail("invalid_state");
  const { data: member, error: memberError } = await db
    .from("members")
    .select("wallet_address")
    .eq("id", req.member_id)
    .maybeSingle<{ wallet_address: string }>();
  if (memberError || !member?.wallet_address) {
    console.error("[treasury] member wallet read failed", req.member_id, safeError(memberError?.message));
    return fail("unknown");
  }
  const destination = member.wallet_address.toLowerCase();

  const r = await withValuation(
    req.chain_id,
    (v) =>
      db.rpc("quote_withdrawal", {
        p_request: id,
        p_safe: v.safe,
        p_assets_usd6: v.assetsUsd6.toString(),
        p_assets_block: v.blockNumber.toString(),
        // F4d: open WETH prizes are valued at this valuation's ETH price
        p_eth_price_e8: v.priceE8.toString(),
      }),
    (data, v) => {
      const q = (data ?? {}) as { amountUsdc?: unknown; reservedUsdc?: unknown };
      const reservedText = String(q.reservedUsdc ?? "0");
      const amountText = String(q.amountUsdc ?? "0");
      // minor 4: never BigInt() a malformed RPC value (it would throw out of the action)
      if (!DIGITS.test(reservedText) || !DIGITS.test(amountText)) return fail("unknown");
      const reserved = BigInt(reservedText);
      const safeUsdc = v.assets.usdc;
      const available = safeUsdc > reserved ? safeUsdc - reserved : 0n;
      return {
        ok: true as const,
        quote: {
          amountUsdc: amountText,
          safeUsdc: safeUsdc.toString(),
          availableUsdc: available.toString(),
          destination,
          selfApproval: req.member_id === me,
        },
      };
    },
  );
  // read-only (F4c minor #7): nothing to revalidate
  return r;
}

/** Treasurer: approves at the market formula recomputed now (SQL fixes the amount; the treasurer cannot adjust it). */
export async function approveWithdrawalAction(id: string): Promise<{ ok: true; amountUsdc: string } | Fail> {
  if (!isId(id)) return fail("invalid_input");
  const me = await treasurerId();
  if (!me) return fail("forbidden");

  const db = createAdminClient();
  const req = await readRequest(db, id);
  if (isFail(req)) return req;
  if (!isChainId(req.chain_id)) return fail("invalid_state");

  const r = await withValuation(
    req.chain_id,
    (v) =>
      db.rpc("approve_withdrawal", {
        p_request: id,
        p_actor: me,
        p_safe: v.safe,
        p_assets_usd6: v.assetsUsd6.toString(),
        p_assets_block: v.blockNumber.toString(),
        p_eth_price_e8: v.priceE8.toString(),
      }),
    (data) => ({ ok: true as const, amountUsdc: String((data as { amountUsdc?: unknown } | null)?.amountUsdc ?? "0") }),
  );
  if (r.ok) revalidate();
  return r;
}

/** Treasurer: rejects a pending request, or an approved one without a payout (SQL checks MANAGE_TREASURY and the reason). */
export async function rejectWithdrawalAction(id: string, reason: string): Promise<{ ok: true } | Fail> {
  if (!isId(id) || typeof reason !== "string") return fail("invalid_input");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("reject_withdrawal", { p_request: id, p_reason: reason });
  if (error) return fail(rpcErrorCode(error));
  revalidate();
  return { ok: true };
}

/**
 * Treasurer: the Safe paid the request; the pasted hash is verified on chain (at least the fixed amount, from the Safe,
 * to the destination snapshotted at approval) and recorded. Shares burn later, at finality (cron).
 */
export async function markWithdrawalPaidAction(id: string, txHash: string): Promise<{ ok: true; status: "recorded" | "already" } | Fail> {
  if (!isId(id) || typeof txHash !== "string" || !TX_HASH.test(txHash.trim())) return fail("invalid_input");
  const hash = txHash.trim().toLowerCase() as `0x${string}`;
  const me = await treasurerId();
  if (!me) return fail("forbidden");

  const db = createAdminClient();
  const req = await readRequest(db, id);
  if (isFail(req)) return req;
  if (!isChainId(req.chain_id)) return fail("invalid_state");
  if (req.status !== "approved" || !req.amount_usdc_locked || !req.approved_at || !req.destination_address) {
    return fail(req.status === "pending" && req.last_expired_at ? "approval_expired" : "invalid_state");
  }
  const safe = await safeAddressOf(db, req.chain_id);
  if (!safe) return fail("safe_not_configured");

  const v = await verifyPayout(
    {
      chain: req.chain_id,
      safe,
      destination: req.destination_address,
      amountLocked: BigInt(req.amount_usdc_locked),
      approvedAt: new Date(req.approved_at),
    },
    hash,
  );
  if (v.status === "pending") return fail("payout_pending");
  if (v.status === "error") return fail(v.code);

  const { data, error } = await db.rpc("record_withdrawal_payout", {
    p_request: id,
    p_safe: safe,
    p_payout: payoutPayload(v, hash, req.destination_address),
    p_actor: me,
  });
  if (error) return fail(rpcErrorCode(error));
  revalidate();
  return { ok: true, status: (data as { status?: unknown } | null)?.status === "already" ? "already" : "recorded" };
}

/** SuperAdmin (ADMINISTRATOR, re-checked in SQL): the per-network withdrawals switch. */
export async function setWithdrawalsEnabledAction(chain: number, enabled: boolean): Promise<{ ok: true } | Fail> {
  if (!isChainId(chain) || typeof enabled !== "boolean") return fail("invalid_input");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_withdrawals_enabled", { p_chain: chain, p_enabled: enabled });
  if (error) return fail(rpcErrorCode(error));
  revalidate();
  return { ok: true };
}
