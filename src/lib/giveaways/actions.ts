"use server";

import { appChainIds, isChainId } from "@/lib/economy/networks";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { drawOne, revalidateGiveaways } from "@/lib/giveaways/cron";
import { roundTime } from "@/lib/giveaways/drand";
import { parseAmount } from "@/lib/payments/amounts";
import { verifyTransfer } from "@/lib/payments/verify";
import { hitRateLimit } from "@/lib/rate-limit";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { treasurerId } from "@/lib/treasury/treasurer";

type Fail = { ok: false; error: string; code: string };
const fail = (code: string): Fail => ({ ok: false, code, error: rpcErrorMessage(code) });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const MAX_PRIZES = 10;
const LABEL_MAX = 120;

const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export type GiveawayPrizeInput =
  | { kind: "crypto"; chainId: number; /** decimal USDC text, "5" or "5,5" */ amount: string; label?: string }
  | { kind: "role"; roleId: string; label?: string }
  | { kind: "custom"; label: string };

export type CreateGiveawayInput = { title: string; description?: string | null; closesAt: string; prizes: GiveawayPrizeInput[] };

/** The prize as create_giveaway expects it (USDC in base units, as text), or null when malformed. */
function prizePayload(p: unknown, chains: readonly number[]): Record<string, unknown> | null {
  if (!p || typeof p !== "object") return null;
  const prize = p as Record<string, unknown>;
  const label = prize.label;
  if (label !== undefined && (typeof label !== "string" || label.trim().length > LABEL_MAX)) return null;
  const withLabel = (o: Record<string, unknown>) => (typeof label === "string" && label.trim() ? { ...o, label: label.trim() } : o);
  if (prize.kind === "crypto") {
    if (!isChainId(prize.chainId) || !chains.includes(prize.chainId) || typeof prize.amount !== "string") return null;
    const units = parseAmount(prize.amount, "USDC");
    if (units === null || units <= 0n) return null;
    return withLabel({ kind: "crypto", chainId: prize.chainId, amount: units.toString() });
  }
  if (prize.kind === "role") {
    if (!isId(prize.roleId)) return null;
    return withLabel({ kind: "role", roleId: prize.roleId.toLowerCase() });
  }
  if (prize.kind === "custom") {
    if (typeof label !== "string" || !label.trim()) return null;
    return { kind: "custom", label: label.trim() };
  }
  return null;
}

/** Treasurer (re-checked in SQL, bit 256): 1..10 prizes, closes between 10 min and 30 days from now. */
export async function createGiveawayAction(
  input: CreateGiveawayInput,
): Promise<{ ok: true; id: string; commit: string; targetRound: number } | Fail> {
  const { title, description, closesAt, prizes } = input ?? ({} as CreateGiveawayInput);
  if (typeof title !== "string" || typeof closesAt !== "string" || !Array.isArray(prizes)) return fail("invalid_input");
  if (description !== undefined && description !== null && typeof description !== "string") return fail("invalid_input");
  // A date without Z or an offset would be read in the server's zone: the form sends toISOString(), nothing else passes.
  const close = new Date(closesAt);
  if (!ISO_WITH_ZONE.test(closesAt) || Number.isNaN(close.getTime())) return fail("invalid_input");
  if (prizes.length < 1 || prizes.length > MAX_PRIZES) return fail("invalid_input");
  const chains = appChainIds();
  const payload = prizes.map((p) => prizePayload(p, chains));
  if (payload.some((p) => p === null)) return fail("invalid_input");

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_giveaway", {
    p_title: title,
    p_description: description?.trim() ? description : null,
    p_closes_at: close.toISOString(),
    p_prizes: payload,
  });
  if (error) {
    const code = rpcErrorCode(error);
    return fail(code === "closes_at_invalid" ? "giveaway_closes_at_invalid" : code);
  }
  const r = (data ?? {}) as { id?: unknown; commit?: unknown; targetRound?: unknown };
  if (typeof r.id !== "string" || typeof r.commit !== "string") return fail("unknown");
  revalidateGiveaways();
  return { ok: true, id: r.id, commit: r.commit, targetRound: Number(r.targetRound) };
}

async function callAsMember(fn: string, args: Record<string, unknown>): Promise<{ ok: true } | Fail> {
  const supabase = await createServerClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return fail(rpcErrorCode(error));
  revalidateGiveaways();
  return { ok: true };
}

/** Treasurer: cancels an open giveaway before closes_at with a public reason; the seed is deleted, never revealed. */
export async function cancelGiveawayAction(id: string, reason: string): Promise<{ ok: true } | Fail> {
  if (!isId(id) || typeof reason !== "string") return fail("invalid_input");
  return callAsMember("cancel_giveaway", { p_id: id, p_reason: reason });
}

/** Member: joins an open giveaway (refused from closes_at on). */
export async function enterGiveawayAction(id: string): Promise<{ ok: true } | Fail> {
  if (!isId(id)) return fail("invalid_input");
  return callAsMember("enter_giveaway", { p_id: id });
}

/** Member: leaves an open giveaway (refused from closes_at on). */
export async function leaveGiveawayAction(id: string): Promise<{ ok: true } | Fail> {
  if (!isId(id)) return fail("invalid_input");
  return callAsMember("leave_giveaway", { p_id: id });
}

/** Treasurer: a custom prize handed over by hand. */
export async function markPrizeDeliveredAction(prizeId: string): Promise<{ ok: true } | Fail> {
  if (!isId(prizeId)) return fail("invalid_input");
  return callAsMember("mark_giveaway_prize_delivered", { p_prize: prizeId });
}

type GiveawayRow = { id: string; status: string; target_round: number | string; drawn_at: string | null };

/**
 * Treasurer, «Sortear ahora» (P1-R12): closes the due giveaways (what the cron does first), then runs the cron's draw
 * step for this one. round_not_ready until its drand round exists; drand down leaves it closed (drand_unavailable).
 */
export async function drawGiveawayNowAction(
  id: string,
): Promise<{ ok: true; status: "drawn" | "already" | "void" } | Fail> {
  if (!isId(id)) return fail("invalid_input");
  if (!(await treasurerId())) return fail("forbidden");

  const db = createAdminClient();
  const closed = await db.rpc("close_due_giveaways");
  if (closed.error) {
    console.error("[giveaways] close_due_giveaways failed", safeError(closed.error.message));
    return fail("unknown");
  }
  const { data: g, error } = await db
    .from("giveaways")
    .select("id, status, target_round, drawn_at")
    .eq("id", id)
    .maybeSingle<GiveawayRow>();
  if (error) {
    console.error("[giveaways] giveaway read failed", safeError(error.message));
    return fail("unknown");
  }
  if (!g) return fail("not_found");
  if (g.status === "drawn") return { ok: true, status: "already" };
  if (g.status === "void") {
    revalidateGiveaways();
    return { ok: true, status: "void" };
  }
  if (g.status === "open") return fail("round_not_ready");
  if (g.status !== "closed") return fail("invalid_state");

  const round = BigInt(g.target_round);
  if (roundTime(round) * 1000 > Date.now()) return fail("round_not_ready");
  const outcome = await drawOne(db, g.id, round);
  if (outcome.status === "waiting" || outcome.status === "failed") return fail(outcome.code);
  revalidateGiveaways();
  return { ok: true, status: outcome.status };
}

type PrizeRow = {
  giveaway_id: string;
  kind: string;
  status: string;
  chain_id: number | null;
  token: string | null;
  amount: string | null;
  winner_address: string | null;
};

/**
 * Treasurer: the Safe paid a USDC prize. The pasted hash is verified on chain (a USDC Transfer from the network's Safe
 * to the winner's wallet snapshotted at the draw, for the exact amount, not before the draw) and only then recorded.
 */
export async function markPrizePaidAction(
  prizeId: string,
  txHash: string,
): Promise<{ ok: true; status: "paid" | "already" } | Fail> {
  if (!isId(prizeId) || typeof txHash !== "string" || !TX_HASH.test(txHash.trim())) return fail("invalid_input");
  const hash = txHash.trim().toLowerCase() as `0x${string}`;
  const actor = await treasurerId();
  if (!actor) return fail("forbidden");

  const limit = await hitRateLimit(await createServerClient(), "chain_verify");
  if (limit === "rate_limited") return fail("rate_limited");
  if (limit !== "ok") return fail("unknown");

  const db = createAdminClient();
  const { data: prize, error: prizeErr } = await db
    .from("giveaway_prizes")
    .select("giveaway_id, kind, status, chain_id, token, amount:amount::text, winner_address")
    .eq("id", prizeId)
    .maybeSingle<PrizeRow>();
  if (prizeErr) {
    console.error("[giveaways] prize read failed", safeError(prizeErr.message));
    return fail("unknown");
  }
  if (!prize) return fail("not_found");
  // 'paid' goes on to the RPC: the same payout again answers 'already'
  if (prize.kind !== "crypto" || (prize.status !== "awarded" && prize.status !== "paid") || !prize.winner_address || !prize.amount) {
    return fail("invalid_state");
  }
  const chain = prize.chain_id;
  if (!isChainId(chain) || !appChainIds().includes(chain)) return fail("chain_invalid");

  const { data: g, error: gErr } = await db.from("giveaways").select("drawn_at").eq("id", prize.giveaway_id).maybeSingle<{ drawn_at: string | null }>();
  if (gErr) {
    console.error("[giveaways] giveaway read failed", safeError(gErr.message));
    return fail("unknown");
  }
  if (!g?.drawn_at) return fail("invalid_state");

  const { data: chainRow, error: chainErr } = await db.from("chains").select("safe_address").eq("chain_id", chain).maybeSingle<{ safe_address: string | null }>();
  if (chainErr) {
    console.error("[giveaways] chains read failed", chain, safeError(chainErr.message));
    return fail("unknown");
  }
  const safe = chainRow?.safe_address;
  if (!safe) return fail("safe_not_configured");

  const r = await verifyTransfer({
    chain,
    token: "USDC",
    txHash: hash,
    from: safe,
    to: prize.winner_address,
    amount: BigInt(prize.amount),
    notBefore: new Date(g.drawn_at),
  });
  if (r.status === "pending") return fail("payout_pending");
  if (r.status === "error") return fail(r.code);

  const { data, error } = await db.rpc("record_giveaway_payout", {
    p_prize: prizeId,
    p_payout: { txHash: hash, logIndex: r.logIndex, blockNumber: r.blockNumber.toString() },
    p_actor: actor,
  });
  if (error) return fail(rpcErrorCode(error));
  revalidateGiveaways();
  return { ok: true, status: (data as { status?: unknown } | null)?.status === "already" ? "already" : "paid" };
}
