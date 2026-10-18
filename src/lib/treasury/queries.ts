// DAO reads. Every function takes a Supabase client and goes through the Task 1 RPCs, which enforce membership and the
// ranking privacy (a hidden donor comes back as "Anónimo" with no member id and no tx hash). Share and USDC amounts
// are numeric(78,0): the RPCs return the large ones as text; the rest are converted here without float rounding.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isChainId, type ChainId } from "@/lib/economy/networks";

export interface DaoOverview {
  chainId: ChainId;
  totalShares: bigint;
  valueUsdc: bigint;
  donors: number;
  myShares: bigint;
  myShareBps: number;
  myNet: bigint;
  myPending: { ledgerId: string; amount: bigint; txHash: string; createdAt: string }[];
}

export interface RankingEntry {
  rank: number;
  /** Null for a hidden donor (other than the viewer). */
  memberId: string | null;
  label: string;
  shareBps: number;
  netUsdc: bigint;
}

export interface HistoryEntry {
  ledgerId: string;
  memberId: string | null;
  label: string;
  amount: bigint;
  /** Null for a hidden donor (the hash would identify them). */
  txHash: string | null;
  creditedAt: string;
}

export interface MyPosition {
  chainId: ChainId;
  shares: bigint;
  shareBps: number;
  netUsdc: bigint;
}

/** numeric(78,0) as bigint from a JSON string or number; anything else is 0. */
function big(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  return 0n;
}

export async function getDaoOverview(supabase: SupabaseClient): Promise<DaoOverview> {
  const { data, error } = await supabase.rpc("dao_overview");
  if (error) throw new Error(error.message);
  const o = (data ?? {}) as Record<string, unknown>;
  const chain = Number(o.chainId);
  const pending = Array.isArray(o.myPending) ? (o.myPending as Record<string, unknown>[]) : [];
  return {
    chainId: isChainId(chain) ? chain : 59141,
    totalShares: big(o.totalShares),
    valueUsdc: big(o.valueUsdc),
    donors: Number(o.donors ?? 0),
    myShares: big(o.myShares),
    myShareBps: Number(o.myShareBps ?? 0),
    myNet: big(o.myNet),
    myPending: pending.map((p) => ({
      ledgerId: String(p.ledgerId),
      amount: big(p.amount),
      txHash: String(p.txHash),
      createdAt: String(p.createdAt),
    })),
  };
}

export async function getDaoRanking(supabase: SupabaseClient, limit = 50): Promise<RankingEntry[]> {
  const { data, error } = await supabase.rpc("dao_ranking", { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    rank: Number(r.rank),
    memberId: typeof r.member_id === "string" ? r.member_id : null,
    label: String(r.label ?? "Anónimo"),
    shareBps: Number(r.share_bps ?? 0),
    netUsdc: big(r.net_usdc),
  }));
}

export async function getDaoHistory(supabase: SupabaseClient, limit = 50): Promise<HistoryEntry[]> {
  const { data, error } = await supabase.rpc("dao_history", { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ledgerId: String(r.ledger_id),
    memberId: typeof r.member_id === "string" ? r.member_id : null,
    label: String(r.label ?? "Anónimo"),
    amount: big(r.amount),
    txHash: typeof r.tx_hash === "string" ? r.tx_hash : null,
    creditedAt: String(r.credited_at),
  }));
}

/** The caller's position on a chain (the active one when omitted). */
export async function getMyDaoPosition(supabase: SupabaseClient, chain?: ChainId): Promise<MyPosition> {
  const { data, error } = await supabase.rpc("my_dao_position", { p_chain: chain ?? null });
  if (error) throw new Error(error.message);
  const r = ((Array.isArray(data) ? data[0] : data) ?? {}) as Record<string, unknown>;
  const id = Number(r.chain_id);
  return {
    chainId: isChainId(id) ? id : (chain ?? 59141),
    shares: big(r.shares),
    shareBps: Number(r.share_bps ?? 0),
    netUsdc: big(r.net_usdc),
  };
}
