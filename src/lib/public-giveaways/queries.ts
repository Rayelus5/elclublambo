import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import {
  PUBLIC_GIVEAWAY_STATUSES,
  PUBLIC_PRIZE_STATUSES,
  type PublicEntry,
  type PublicGiveawayCard,
  type PublicGiveawayStatus,
  type PublicGiveawayView,
  type PublicPrize,
  type PublicPrizeStatus,
} from "@/lib/public-giveaways/types";

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPublicGiveawayId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]).filter((r) => r !== null && typeof r === "object") : []);
const isStatus = (v: unknown): v is PublicGiveawayStatus => (PUBLIC_GIVEAWAY_STATUSES as readonly unknown[]).includes(v);
const isPrizeStatus = (v: unknown): v is PublicPrizeStatus => (PUBLIC_PRIZE_STATUSES as readonly unknown[]).includes(v);

function prize(r: Row): PublicPrize | null {
  if ((r.kind !== "crypto" && r.kind !== "custom") || typeof r.id !== "string" || !isPrizeStatus(r.status)) return null;
  return {
    id: r.id,
    rank: num(r.rank),
    kind: r.kind,
    chainId: numOrNull(r.chainId),
    token: strOrNull(r.token),
    amount: strOrNull(r.amount),
    label: str(r.label),
    status: r.status,
    unawardedReason: strOrNull(r.unawardedReason),
    winnerPosition: numOrNull(r.winnerPosition),
    winnerAddress: strOrNull(r.winnerAddress),
    payoutTxHash: strOrNull(r.payoutTxHash),
    paidAt: strOrNull(r.paidAt),
    deliveredAt: strOrNull(r.deliveredAt),
  };
}

const entry = (r: Row): PublicEntry => ({ position: numOrNull(r.position), walletAddress: str(r.walletAddress) });

function view(r: Row): PublicGiveawayView | null {
  if (typeof r.id !== "string" || !isStatus(r.status)) return null;
  return {
    id: r.id,
    title: str(r.title),
    description: strOrNull(r.description),
    hostName: strOrNull(r.hostName),
    hostAddress: str(r.hostAddress),
    closesAt: str(r.closesAt),
    status: r.status,
    targetRound: num(r.targetRound),
    seedCommit: str(r.seedCommit),
    seedReveal: strOrNull(r.seedReveal),
    drandSignature: strOrNull(r.drandSignature),
    drandRandomness: strOrNull(r.drandRandomness),
    entryCount: num(r.entryCount),
    minTxCount: num(r.minTxCount),
    hasAllowlist: r.hasAllowlist === true,
    isHost: r.isHost === true,
    iEntered: r.iEntered === true,
    drawnAt: strOrNull(r.drawnAt),
    cancelledAt: strOrNull(r.cancelledAt),
    createdAt: str(r.createdAt),
    entries: arr(r.entries).map(entry),
    prizes: arr(r.prizes).flatMap((p) => prize(p) ?? []),
  };
}

/** One public giveaway for a visitor (`viewer` = their user id, or null). Admin read: the RPC is service-role only. */
export async function getPublicGiveaway(id: string, viewer: string | null): Promise<PublicGiveawayView | null> {
  if (!isPublicGiveawayId(id)) return null;
  const { data, error } = await createAdminClient().rpc("public_giveaway_view", { p_id: id, p_viewer: viewer });
  if (error) throw new Error(`public_giveaway_view: ${error.message}`);
  if (!data || typeof data !== "object") return null;
  return view(data as Row);
}

/** The signed-in host's own giveaways (their JWT; the RPC filters by auth.uid()). */
export async function getMyPublicGiveaways(limit = 20): Promise<PublicGiveawayCard[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("my_public_giveaways", { p_limit: limit });
  if (error) throw new Error(`my_public_giveaways: ${error.message}`);
  return arr(data).flatMap((r): PublicGiveawayCard[] =>
    typeof r.id === "string" && isStatus(r.status)
      ? [{ id: r.id, title: str(r.title), status: r.status, closesAt: str(r.closesAt), entryCount: num(r.entryCount), prizeCount: num(r.prizeCount) }]
      : [],
  );
}
