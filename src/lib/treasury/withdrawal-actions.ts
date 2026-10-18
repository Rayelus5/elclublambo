"use server";

import { revalidatePath } from "next/cache";
import { isChainId, type ChainId } from "@/lib/economy/networks";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { payoutPayload, verifyPayout } from "@/lib/treasury/payouts";
import { safeAddressOf, valueSafe, type SafeValuation } from "@/lib/treasury/snapshot";

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

/** The caller's member id when they hold MANAGE_TREASURY (or ADMINISTRATOR), else null. Uses the caller's JWT only. */
async function treasurerId(): Promise<string | null> {
  const supabase = await createServerClient();
  const [perms, me] = await Promise.all([supabase.rpc("my_permissions"), supabase.rpc("current_member_id")]);
  const raw = String(perms.data ?? "0");
  const bits = /^\d+$/.test(raw) ? BigInt(raw) : 0n;
  if (!hasPerm(bits, Perm.MANAGE_TREASURY)) return null;
  return typeof me.data === "string" ? me.data : null;
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

async function readRequest(db: Db, id: string): Promise<RequestRow | null> {
  const { data, error } = await db
    .from("withdrawal_requests")
    .select("chain_id, member_id, status, destination_address, amount_usdc_locked:amount_usdc_locked::text, approved_at, last_expired_at")
    .eq("id", id)
    .maybeSingle<RequestRow>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function safeValuation(chain: ChainId): Promise<SafeValuation | null> {
  try {
    return await valueSafe(chain);
  } catch (e) {
    console.error("[treasury] valuation failed", chain, e);
    return null;
  }
}

/**
 * Runs a valuation-bound service RPC: a fresh Safe valuation each try, `valuation_unavailable` without one, and one
 * retry when SQL answers `assets_stale` (a donation was credited after the read).
 */
async function withValuation<T>(
  chain: ChainId,
  call: (v: SafeValuation) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>,
  done: (data: unknown, v: SafeValuation) => T,
): Promise<T | Fail> {
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
  if (!req) return fail("not_found");
  if (!isChainId(req.chain_id)) return fail("invalid_state");
  const { data: member } = await db.from("members").select("wallet_address").eq("id", req.member_id).maybeSingle<{ wallet_address: string }>();

  const r = await withValuation(
    req.chain_id,
    (v) =>
      db.rpc("quote_withdrawal", {
        p_request: id,
        p_safe: v.safe,
        p_assets_usd6: v.assetsUsd6.toString(),
        p_assets_block: v.blockNumber.toString(),
      }),
    (data, v) => {
      const q = (data ?? {}) as { amountUsdc?: unknown; reservedUsdc?: unknown };
      const reserved = BigInt(String(q.reservedUsdc ?? "0"));
      const safeUsdc = v.assets.usdc;
      const available = safeUsdc > reserved ? safeUsdc - reserved : 0n;
      return {
        ok: true as const,
        quote: {
          amountUsdc: String(q.amountUsdc ?? "0"),
          safeUsdc: safeUsdc.toString(),
          availableUsdc: available.toString(),
          destination: (member?.wallet_address ?? "").toLowerCase(),
          selfApproval: req.member_id === me,
        },
      };
    },
  );
  if (r.ok) revalidate();
  return r;
}

/** Treasurer: approves at the market formula recomputed now (SQL fixes the amount; the treasurer cannot adjust it). */
export async function approveWithdrawalAction(id: string): Promise<{ ok: true; amountUsdc: string } | Fail> {
  if (!isId(id)) return fail("invalid_input");
  const me = await treasurerId();
  if (!me) return fail("forbidden");

  const db = createAdminClient();
  const req = await readRequest(db, id);
  if (!req) return fail("not_found");
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
  if (!req) return fail("not_found");
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
