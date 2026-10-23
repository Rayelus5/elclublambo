"use server";

import { safeError } from "@/lib/security/redact";
import { revalidatePath } from "next/cache";
import { isLegacyChainId } from "@/lib/legacy/linea";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { hitRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { prizePayload, verifyPrizePayout } from "@/lib/treasury/raffle-cron";
import { isPrizeToken, parsePrize, type PrizeToken, type RaffleMode } from "@/lib/treasury/raffles";
import { safeAddressOf } from "@/lib/treasury/snapshot";
import { treasurerId } from "@/lib/treasury/treasurer";

type Fail = { ok: false; error: string; code: string };
const fail = (code: string): Fail => ({ ok: false, code, error: rpcErrorMessage(code) });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const DIGITS = /^\d{1,78}$/;

const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isMode = (v: unknown): v is RaffleMode => v === "equal" || v === "weighted";

function revalidate(id?: string) {
  revalidatePath("/dao");
  revalidatePath("/dao/tesoreria");
  if (id) revalidatePath(`/dao/sorteos/${id}`);
}

/** Treasurer (re-checked in SQL): a raffle on the active chain; `prize` is decimal text in the prize token's units. */
export async function createRaffleAction(input: {
  title: string;
  prizeToken: PrizeToken;
  prize: string;
  closesAt: string;
  mode: RaffleMode;
}): Promise<{ ok: true; id: string; commit: string } | Fail> {
  const { title, prizeToken, prize, closesAt, mode } = input ?? ({} as typeof input);
  if (typeof title !== "string" || !isPrizeToken(prizeToken) || !isMode(mode) || typeof prize !== "string" || typeof closesAt !== "string") {
    return fail("invalid_input");
  }
  const amount = parsePrize(prize, prizeToken);
  const close = new Date(closesAt);
  // A date without Z or an offset would be read in the server's zone: the form sends toISOString(), nothing else passes.
  if (amount === null || amount <= 0n || !ISO_WITH_ZONE.test(closesAt) || Number.isNaN(close.getTime())) return fail("invalid_input");

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_raffle", {
    p_title: title,
    p_prize_token: prizeToken,
    p_prize_amount: amount.toString(),
    p_closes_at: close.toISOString(),
    p_mode: mode,
  });
  if (error) return fail(rpcErrorCode(error));
  const r = (data ?? {}) as { id?: unknown; commit?: unknown };
  if (typeof r.id !== "string" || typeof r.commit !== "string") return fail("unknown");
  revalidate(r.id);
  return { ok: true, id: r.id, commit: r.commit };
}

/** Treasurer: cancels an open or closed raffle with a public reason (the prize goes back to the fund). */
export async function cancelRaffleAction(id: string, reason: string): Promise<{ ok: true } | Fail> {
  if (!isId(id) || typeof reason !== "string") return fail("invalid_input");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("cancel_raffle", { p_raffle: id, p_reason: reason });
  if (error) return fail(rpcErrorCode(error));
  revalidate(id);
  return { ok: true };
}

/** Member: joins an open raffle (refused from closes_at on). */
export async function enterRaffleAction(id: string): Promise<{ ok: true } | Fail> {
  if (!isId(id)) return fail("invalid_input");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("enter_raffle", { p_raffle: id });
  if (error) return fail(rpcErrorCode(error));
  revalidate(id);
  return { ok: true };
}

/** Member: leaves an open raffle (refused from closes_at on). */
export async function leaveRaffleAction(id: string): Promise<{ ok: true } | Fail> {
  if (!isId(id)) return fail("invalid_input");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("leave_raffle", { p_raffle: id });
  if (error) return fail(rpcErrorCode(error));
  revalidate(id);
  return { ok: true };
}

type RaffleRow = {
  chain_id: number;
  status: string;
  prize_token: string;
  prize_amount: string;
  winner_address: string | null;
  drawn_at: string | null;
  payout_tx_hash: string | null;
};

/**
 * Treasurer: the Safe paid the prize; the pasted hash is verified on chain (the prize token, at least the prize, from
 * the Safe, to the winner's wallet snapshotted at the draw, not before the draw) and recorded. The raffle is marked
 * paid later, at finality (cron).
 */
export async function markRafflePaidAction(id: string, txHash: string): Promise<{ ok: true; status: "recorded" | "already" } | Fail> {
  if (!isId(id) || typeof txHash !== "string" || !TX_HASH.test(txHash.trim())) return fail("invalid_input");
  const hash = txHash.trim().toLowerCase() as `0x${string}`;
  const me = await treasurerId();
  if (!me) return fail("forbidden");

  const db = createAdminClient();
  const { data: raffle, error: readError } = await db
    .from("raffles")
    .select("chain_id, status, prize_token, prize_amount:prize_amount::text, winner_address, drawn_at, payout_tx_hash")
    .eq("id", id)
    .maybeSingle<RaffleRow>();
  if (readError) {
    console.error("[treasury] raffle read failed", id, safeError(readError.message));
    return fail("unknown");
  }
  if (!raffle) return fail("not_found");
  if (raffle.payout_tx_hash === hash && (raffle.status === "drawn" || raffle.status === "paid")) return { ok: true, status: "already" };
  if (
    raffle.status !== "drawn" ||
    raffle.payout_tx_hash !== null ||
    !isLegacyChainId(raffle.chain_id) ||
    !isPrizeToken(raffle.prize_token) ||
    !raffle.winner_address ||
    !raffle.drawn_at ||
    !DIGITS.test(String(raffle.prize_amount))
  ) {
    return fail("invalid_state");
  }
  const safe = await safeAddressOf(db, raffle.chain_id);
  if (!safe) return fail("safe_not_configured");

  // F5-R2 chain_verify pre-hit (its own transaction, the caller's JWT) before the on-chain verification.
  const limit = await hitRateLimit(await createServerClient(), "chain_verify");
  if (limit !== "ok") return fail(limit === "rate_limited" ? "rate_limited" : "unknown");

  const v = await verifyPrizePayout(
    {
      chain: raffle.chain_id,
      safe,
      token: raffle.prize_token,
      winner: raffle.winner_address,
      prize: BigInt(raffle.prize_amount),
      drawnAt: new Date(raffle.drawn_at),
    },
    hash,
  );
  if (v.status === "pending") return fail("payout_pending");
  if (v.status === "error") return fail(v.code);

  const { data, error } = await db.rpc("record_raffle_payout", {
    p_raffle: id,
    p_safe: safe,
    p_payout: prizePayload(v, hash, raffle.winner_address, raffle.prize_token),
    p_actor: me,
  });
  if (error) return fail(rpcErrorCode(error));
  revalidate(id);
  return { ok: true, status: (data as { status?: unknown } | null)?.status === "already" ? "already" : "recorded" };
}

/** SuperAdmin (ADMINISTRATOR, re-checked in SQL): the per-network weighted raffles switch (gates creation only). */
export async function setWeightedRafflesEnabledAction(chain: number, enabled: boolean): Promise<{ ok: true } | Fail> {
  if (!isLegacyChainId(chain) || typeof enabled !== "boolean") return fail("invalid_input");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_weighted_raffles_enabled", { p_chain: chain, p_enabled: enabled });
  if (error) return fail(rpcErrorCode(error));
  revalidate();
  return { ok: true };
}
