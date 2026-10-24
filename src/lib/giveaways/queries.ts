// Giveaway reads through the member-facing definer RPCs (giveaways_list, giveaway_detail). Amounts arrive as text and
// become bigint here; anything with an unknown status or kind (a newer schema) is dropped rather than shown wrong.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GIVEAWAY_STATUSES,
  PRIZE_KINDS,
  PRIZE_STATUSES,
  type GiveawayCard,
  type GiveawayDetail,
  type GiveawayEntry,
  type GiveawayPrize,
  type GiveawayPrizeState,
  type GiveawayStatus,
  type GiveawayWinner,
  type PrizeKind,
  type PrizeStatus,
} from "@/lib/giveaways/types";

type Client = Pick<SupabaseClient, "rpc">;
type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]).filter((r) => r !== null && typeof r === "object") : []);
const bigOrNull = (v: unknown): bigint | null => {
  if (v === null || v === undefined) return null;
  try {
    return BigInt(String(v));
  } catch {
    return null;
  }
};
const isStatus = (v: unknown): v is GiveawayStatus => (GIVEAWAY_STATUSES as readonly unknown[]).includes(v);
const isKind = (v: unknown): v is PrizeKind => (PRIZE_KINDS as readonly unknown[]).includes(v);
const isPrizeStatus = (v: unknown): v is PrizeStatus => (PRIZE_STATUSES as readonly unknown[]).includes(v);

function prize(r: Row): GiveawayPrize | null {
  if (!isKind(r.kind)) return null;
  return { rank: num(r.rank), kind: r.kind, label: str(r.label), chainId: numOrNull(r.chainId), amount: bigOrNull(r.amount) };
}

const winner = (r: Row): GiveawayWinner => ({ rank: num(r.rank), label: strOrNull(r.label), iWon: r.iWon === true });

function card(r: Row): GiveawayCard | null {
  if (!isStatus(r.status) || typeof r.id !== "string") return null;
  return {
    id: r.id,
    title: str(r.title),
    closesAt: str(r.closesAt),
    status: r.status,
    entryCount: num(r.entryCount),
    iEntered: r.iEntered === true,
    prizes: arr(r.prizes).flatMap((p) => prize(p) ?? []),
    winners: arr(r.winners).map(winner),
  };
}

const entry = (r: Row): GiveawayEntry => ({ position: numOrNull(r.position), label: strOrNull(r.label), isMe: r.isMe === true });

function prizeState(r: Row): GiveawayPrizeState | null {
  const base = prize(r);
  if (!base || !isPrizeStatus(r.status)) return null;
  const reason = r.unawardedReason === "not_enough_entries" || r.unawardedReason === "role_unavailable" ? r.unawardedReason : null;
  return {
    ...base,
    id: str(r.id),
    token: r.token === "USDC" ? "USDC" : null,
    status: r.status,
    unawardedReason: reason,
    winnerPosition: numOrNull(r.winnerPosition),
    winnerLabel: strOrNull(r.winnerLabel),
    iWon: r.iWon === true,
    winnerAddress: strOrNull(r.winnerAddress),
    payoutTxHash: strOrNull(r.payoutTxHash),
    paidAt: strOrNull(r.paidAt),
    deliveredAt: strOrNull(r.deliveredAt),
  };
}

export async function getGiveaways(supabase: Client, limit = 30): Promise<GiveawayCard[]> {
  const { data, error } = await supabase.rpc("giveaways_list", { p_limit: limit });
  if (error) throw new Error(error.message);
  return arr(data).flatMap((r) => card(r) ?? []);
}

/** null when the giveaway does not exist (or the id is malformed). */
export async function getGiveaway(supabase: Client, id: string): Promise<GiveawayDetail | null> {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const { data, error } = await supabase.rpc("giveaway_detail", { p_id: id });
  if (error) {
    if (error.message === "not_found") return null;
    throw new Error(error.message);
  }
  const r = (data ?? {}) as Row;
  const c = card(r);
  if (!c) return null;
  return {
    ...c,
    description: strOrNull(r.description),
    commit: str(r.commit),
    seedReveal: strOrNull(r.seedReveal),
    targetRound: bigOrNull(r.targetRound) ?? 0n,
    drandSignature: strOrNull(r.drandSignature),
    drandRandomness: strOrNull(r.drandRandomness),
    drawnAt: strOrNull(r.drawnAt),
    cancelReason: strOrNull(r.cancelReason),
    entries: arr(r.entries).map(entry),
    prizeStates: arr(r.prizeStates).flatMap((p) => prizeState(p) ?? []),
  };
}
