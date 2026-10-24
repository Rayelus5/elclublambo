// Donation reads. Every list comes from a definer RPC (supabase/migrations/20261024200003_donations.sql); amounts arrive
// as text and become bigint here (same pattern as src/lib/home/queries.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Token } from "@/lib/payments/amounts";

type Client = Pick<SupabaseClient, "rpc">;
type Row = Record<string, unknown>;

export interface DonationOverview {
  totalUsd6: bigint;
  donorCount: number;
  byChain: { chainId: number; usd6: bigint }[];
  recent: { id: string; at: string; chainId: number; token: Token; amount: bigint; usd6: bigint; donorLabel: string | null }[];
}

export interface DonorRankRow {
  memberId: string;
  label: string;
  totalUsd6: bigint;
  isMe: boolean;
}

export interface MyDonorStatus {
  totalUsd6: bigint;
  isMecenas: boolean;
  visible: boolean;
}

const big = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

async function call(supabase: Client, fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function getDonationOverview(supabase: Client): Promise<DonationOverview> {
  const d = ((await call(supabase, "donation_overview")) ?? {}) as Row;
  return {
    totalUsd6: big(d.totalUsd6),
    donorCount: num(d.donorCount),
    byChain: arr(d.byChain).map((r) => ({ chainId: num(r.chainId), usd6: big(r.usd6) })),
    recent: arr(d.recent).map((r) => ({
      id: str(r.id),
      at: str(r.at),
      chainId: num(r.chainId),
      token: r.token === "ETH" ? "ETH" : "USDC",
      amount: big(r.amount),
      usd6: big(r.usd6),
      donorLabel: typeof r.donorLabel === "string" ? r.donorLabel : null,
    })),
  };
}

export async function getDonorRanking(supabase: Client, limit = 50): Promise<DonorRankRow[]> {
  return arr(await call(supabase, "donor_ranking", { p_limit: limit })).map((r) => ({
    memberId: str(r.member_id),
    label: str(r.label),
    totalUsd6: big(r.total_usd6),
    isMe: r.is_me === true,
  }));
}

export async function getMyDonorStatus(supabase: Client): Promise<MyDonorStatus> {
  const d = ((await call(supabase, "my_donor_status")) ?? {}) as Row;
  return { totalUsd6: big(d.totalUsd6), isMecenas: d.isMecenas === true, visible: d.visible !== false };
}
