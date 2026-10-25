"use server";

import { revalidatePath } from "next/cache";
import { appChainIds, isChainId } from "@/lib/economy/networks";
import { getPublicSession } from "@/lib/auth/public-session";
import { parseAmount } from "@/lib/payments/amounts";
import { verifyTransfer } from "@/lib/payments/verify";
import { hitRateLimit } from "@/lib/rate-limit";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { countTransactions } from "@/lib/public-giveaways/tx-count";
import {
  PUBLIC_PRIZE_STATUSES,
  type PublicFail,
  type PublicGiveawayError,
  type PublicGiveawayInput,
  type PublicPrizeStatus,
} from "@/lib/public-giveaways/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const MAX_PRIZES = 10;
const MAX_ALLOWLIST = 2000;
const LABEL_MAX = 120;

const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Codes the SQL raises (exception message) that the actions hand to the UI as they are. */
const DB_CODES: ReadonlySet<string> = new Set([
  "forbidden",
  "not_found",
  "invalid_input",
  "invalid_state",
  "chain_invalid",
  "not_allowed",
  "giveaway_closed",
  "giveaway_full",
  "too_many_open",
  "tx_already_used",
  "rate_limited",
]);

/** The SQL message as a public code ("40P01"/"40001" retry); anything unknown is "unknown". */
function dbCode(error: { message?: string; code?: string } | null | undefined): PublicGiveawayError {
  if (error?.code === "40P01" || error?.code === "40001") return "retry";
  const m = error?.message;
  return m && DB_CODES.has(m) ? (m as PublicGiveawayError) : "unknown";
}

const fail = (error: PublicGiveawayError, detail?: string): PublicFail => (detail === undefined ? { ok: false, error } : { ok: false, error, detail });

/** The public pages of one giveaway and the lists, in their internal paths (the proxy rewrites the Spanish URLs to these). */
function revalidatePublicGiveaway(id: string) {
  for (const lang of ["es", "en"]) {
    revalidatePath(`/${lang}/tools/giveaways/${id}`);
    revalidatePath(`/${lang}/tools/giveaways`);
  }
}

/** Pasted text -> lower-cased, deduped addresses; the first invalid entry otherwise. */
function parseAllowlist(text: string): { ok: true; list: string[] } | { ok: false; bad: string } {
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,;]+/)) {
    if (!raw) continue;
    const a = raw.toLowerCase();
    if (!ADDRESS.test(a)) return { ok: false, bad: raw.slice(0, 64) };
    seen.add(a);
  }
  return { ok: true, list: [...seen] };
}

/** The prize as create_public_giveaway expects it (USDC in base units as text), or null when malformed. */
function prizePayload(p: unknown, chains: readonly number[]): Record<string, unknown> | null {
  if (!p || typeof p !== "object") return null;
  const prize = p as Record<string, unknown>;
  if (prize.kind === "crypto") {
    if (!isChainId(prize.chainId) || !chains.includes(prize.chainId) || typeof prize.amount !== "string") return null;
    const units = parseAmount(prize.amount, "USDC");
    if (units === null || units <= 0n) return null;
    return { kind: "crypto", chainId: prize.chainId, amount: units.toString() };
  }
  if (prize.kind === "custom") {
    if (typeof prize.label !== "string" || !prize.label.trim() || prize.label.trim().length > LABEL_MAX) return null;
    return { kind: "custom", label: prize.label.trim() };
  }
  return null;
}

/** Public account (re-checked in SQL): 1..10 prizes, closes between 10 min and 90 days from now, 5 a day. */
export async function createPublicGiveawayAction(input: PublicGiveawayInput): Promise<{ ok: true; id: string } | PublicFail> {
  const { title, description, closesAt, hostName, minTxCount, allowlist, prizes } = input ?? ({} as PublicGiveawayInput);
  if (typeof title !== "string" || typeof closesAt !== "string" || !Array.isArray(prizes)) return fail("invalid_input");
  if ((description !== undefined && typeof description !== "string") || (hostName !== undefined && typeof hostName !== "string")) return fail("invalid_input");
  if (allowlist !== undefined && typeof allowlist !== "string") return fail("invalid_input");
  if (!Number.isInteger(minTxCount) || minTxCount < 0 || minTxCount > 1000) return fail("invalid_input");
  // A date without Z or an offset would be read in the server's zone: only the form's toISOString() passes.
  const close = new Date(closesAt);
  if (!ISO_WITH_ZONE.test(closesAt) || Number.isNaN(close.getTime())) return fail("invalid_input");
  if (prizes.length < 1 || prizes.length > MAX_PRIZES) return fail("invalid_input");
  const chains = appChainIds();
  const payload = prizes.map((p) => prizePayload(p, chains));
  if (payload.some((p) => p === null)) return fail("invalid_input");
  const allow = parseAllowlist(allowlist ?? "");
  if (!allow.ok) return fail("invalid_allowlist", allow.bad);
  if (allow.list.length > MAX_ALLOWLIST) return fail("invalid_input");

  if (!(await getPublicSession())) return fail("not_authenticated");
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_public_giveaway", {
    p_title: title,
    p_description: description?.trim() ? description : null,
    p_closes_at: close.toISOString(),
    p_host_name: hostName?.trim() ? hostName : null,
    p_min_tx_count: minTxCount,
    p_allowlist: allow.list,
    p_prizes: payload,
  });
  if (error) return fail(dbCode(error));
  if (typeof data !== "string") return fail("unknown");
  revalidatePublicGiveaway(data);
  return { ok: true, id: data };
}

/**
 * Public account: joins an open giveaway. The minimum-transactions rule is checked here, before the service-role RPC.
 * A giveaway already closed answers giveaway_closed before anything else; the on-chain count is charged to the
 * chain_verify bucket first and fails closed (F5-R2), like the payout verification.
 */
export async function enterPublicGiveawayAction(id: string): Promise<{ ok: true } | PublicFail> {
  if (!isId(id)) return fail("invalid_input");
  const session = await getPublicSession();
  if (!session) return fail("not_authenticated");

  const db = createAdminClient();
  const { data: g, error: gErr } = await db
    .from("public_giveaways")
    .select("min_tx_count, status, closes_at")
    .eq("id", id)
    .maybeSingle<{ min_tx_count: number; status: string; closes_at: string }>();
  if (gErr) {
    console.error("[public-giveaways] giveaway read failed", safeError(gErr.message));
    return fail("unknown");
  }
  if (!g) return fail("not_found");
  if (g.status !== "open" || !(new Date(g.closes_at).getTime() > Date.now())) return fail("giveaway_closed");
  if (g.min_tx_count > 0) {
    const limit = await hitRateLimit(await createServerClient(), "chain_verify");
    if (limit === "rate_limited") return fail("rate_limited");
    if (limit !== "ok") return fail("unknown");
    let count: number;
    try {
      count = await countTransactions(session.wallet);
    } catch (e) {
      console.error("[public-giveaways] transaction count failed", safeError(e));
      return fail("chain_unavailable");
    }
    if (count < g.min_tx_count) return fail("min_tx_not_met");
  }
  const { error } = await db.rpc("enter_public_giveaway", { p_id: id, p_user: session.userId, p_wallet: session.wallet });
  if (error) return fail(dbCode(error));
  revalidatePublicGiveaway(id);
  return { ok: true };
}

async function callAsUser(fn: string, args: Record<string, unknown>, id: string): Promise<{ ok: true } | PublicFail> {
  if (!(await getPublicSession())) return fail("not_authenticated");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return fail(dbCode(error));
  revalidatePublicGiveaway(id);
  return { ok: true };
}

/** Leaves an open giveaway before closes_at. */
export async function leavePublicGiveawayAction(id: string): Promise<{ ok: true } | PublicFail> {
  if (!isId(id)) return fail("invalid_input");
  return callAsUser("leave_public_giveaway", { p_id: id }, id);
}

/** The host cancels an open giveaway before closes_at. */
export async function cancelPublicGiveawayAction(id: string): Promise<{ ok: true } | PublicFail> {
  if (!isId(id)) return fail("invalid_input");
  return callAsUser("cancel_public_giveaway", { p_id: id }, id);
}

/** The host handed a custom prize over. */
export async function markPublicPrizeDeliveredAction(prizeId: string): Promise<{ ok: true } | PublicFail> {
  if (!isId(prizeId)) return fail("invalid_input");
  if (!(await getPublicSession())) return fail("not_authenticated");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("mark_public_prize_delivered", { p_prize: prizeId });
  if (error) return fail(dbCode(error));
  const { data } = await createAdminClient().from("public_giveaway_prizes").select("giveaway_id").eq("id", prizeId).maybeSingle<{ giveaway_id: string }>();
  if (data?.giveaway_id) revalidatePublicGiveaway(data.giveaway_id);
  return { ok: true };
}

/**
 * The host's fresh view of one prize's status, read right before «Pagar ahora» opens the wallet: a stale tab (or another
 * device) whose page still shows the prize awarded must not send a second transfer.
 */
export async function getPublicPrizeStatusAction(prizeId: string): Promise<{ ok: true; status: PublicPrizeStatus } | PublicFail> {
  if (!isId(prizeId)) return fail("invalid_input");
  const session = await getPublicSession();
  if (!session) return fail("not_authenticated");
  const db = createAdminClient();
  const { data: prize, error: prizeErr } = await db
    .from("public_giveaway_prizes")
    .select("giveaway_id, status")
    .eq("id", prizeId)
    .maybeSingle<{ giveaway_id: string; status: string }>();
  if (prizeErr) {
    console.error("[public-giveaways] prize read failed", safeError(prizeErr.message));
    return fail("unknown");
  }
  if (!prize) return fail("not_found");
  const { data: g, error: gErr } = await db
    .from("public_giveaways")
    .select("host_user_id")
    .eq("id", prize.giveaway_id)
    .maybeSingle<{ host_user_id: string }>();
  if (gErr) {
    console.error("[public-giveaways] giveaway read failed", safeError(gErr.message));
    return fail("unknown");
  }
  if (!g) return fail("not_found");
  if (g.host_user_id !== session.userId) return fail("forbidden");
  if (!(PUBLIC_PRIZE_STATUSES as readonly string[]).includes(prize.status)) return fail("unknown");
  return { ok: true, status: prize.status as PublicPrizeStatus };
}

type PrizeRow = { giveaway_id: string; kind: string; status: string; chain_id: number | null; amount: string | null; winner_address: string | null };
type GiveawayRow = { host_user_id: string; host_address: string; drawn_at: string | null };

/**
 * The host paid a USDC prize: the pasted hash is verified on chain (USDC Transfer from the host's address to the winner
 * snapshotted at the draw, for the exact amount, not before the draw) and only then recorded. Any verification failure
 * answers its code and leaves the database untouched. Result codes are verify.ts's (tx_mismatch covers wrong sender,
 * amount, recipient and token; tx_not_found, tx_too_old, pending, rpc_unavailable...).
 */
export async function markPublicPrizePaidAction(prizeId: string, txHash: string): Promise<{ ok: true; status: "paid" | "already" } | PublicFail> {
  if (!isId(prizeId) || typeof txHash !== "string" || !TX_HASH.test(txHash.trim())) return fail("invalid_input");
  const hash = txHash.trim().toLowerCase() as `0x${string}`;
  const session = await getPublicSession();
  if (!session) return fail("not_authenticated");

  const limit = await hitRateLimit(await createServerClient(), "chain_verify");
  if (limit === "rate_limited") return fail("rate_limited");
  if (limit !== "ok") return fail("unknown");

  const db = createAdminClient();
  const { data: prize, error: prizeErr } = await db
    .from("public_giveaway_prizes")
    .select("giveaway_id, kind, status, chain_id, amount:amount::text, winner_address")
    .eq("id", prizeId)
    .maybeSingle<PrizeRow>();
  if (prizeErr) {
    console.error("[public-giveaways] prize read failed", safeError(prizeErr.message));
    return fail("unknown");
  }
  if (!prize) return fail("not_found");
  const { data: g, error: gErr } = await db
    .from("public_giveaways")
    .select("host_user_id, host_address, drawn_at")
    .eq("id", prize.giveaway_id)
    .maybeSingle<GiveawayRow>();
  if (gErr) {
    console.error("[public-giveaways] giveaway read failed", safeError(gErr.message));
    return fail("unknown");
  }
  if (!g) return fail("not_found");
  if (g.host_user_id !== session.userId) return fail("forbidden");
  // 'paid' goes on to the RPC: the same payout again answers 'already'
  if (prize.kind !== "crypto" || (prize.status !== "awarded" && prize.status !== "paid") || !prize.winner_address || !prize.amount || !g.drawn_at) {
    return fail("invalid_state");
  }
  const chain = prize.chain_id;
  if (!isChainId(chain) || !appChainIds().includes(chain)) return fail("chain_invalid");

  const r = await verifyTransfer({
    chain,
    token: "USDC",
    txHash: hash,
    from: g.host_address,
    to: prize.winner_address,
    amount: BigInt(prize.amount),
    notBefore: new Date(g.drawn_at),
  });
  if (r.status === "pending") return fail("pending");
  if (r.status === "error") return fail(r.code);

  const { data, error } = await db.rpc("record_public_giveaway_payout", {
    p_prize: prizeId,
    p_payout: { txHash: hash, logIndex: r.logIndex, blockNumber: r.blockNumber.toString() },
    p_actor: session.userId,
  });
  if (error) return fail(dbCode(error));
  revalidatePublicGiveaway(prize.giveaway_id);
  return { ok: true, status: data === "already" ? "already" : "paid" };
}
