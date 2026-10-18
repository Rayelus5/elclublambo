// DAO reads. Every function takes a Supabase client and goes through the Task 1 RPCs, which enforce membership and the
// ranking privacy (a hidden donor comes back as "Anónimo" with no member id and no tx hash). Share and USDC amounts
// are numeric(78,0): the RPCs return the large ones as text; the rest are converted here without float rounding.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isChainId, type ChainId } from "@/lib/economy/networks";
import type { FundAsset } from "@/lib/treasury/format";
import { parseMyWithdrawal, type MyWithdrawal } from "@/lib/treasury/withdrawals";

/** The Safe's holdings at the latest NAV snapshot (base units; ETH/WETH in wei, the price with 8 decimals). */
export interface Composition {
  usdcUnits: bigint;
  ethWei: bigint;
  wethWei: bigint;
  ethPriceE8: bigint;
  priceSource: "chainlink" | "coingecko";
  takenAt: string;
}

export interface DaoOverview {
  chainId: ChainId;
  totalShares: bigint;
  valueUsdc: bigint;
  donors: number;
  myShares: bigint;
  myShareBps: number;
  myNet: bigint;
  myPending: { ledgerId: string; amount: bigint; txHash: string; createdAt: string }[];
  /** Market value of the fund (USD6): the Safe's assets at market minus the liabilities SQL knows. */
  navUsd6: bigint;
  /** When the NAV was last set (null before the first valuation). */
  navAt: string | null;
  /** USD6 value of one participación (10^18 shares); 0 while nobody holds shares. */
  sharePriceUsd6: bigint;
  /** The viewer's part of the NAV (USD6). */
  myValueUsd6: bigint;
  /** Shares of the non-withdrawable "Fondo del club" position. */
  clubShares: bigint;
  composition: Composition | null;
  /** chain_config.withdrawals_enabled on the active chain (SuperAdmin's per-network switch). */
  withdrawalsEnabled: boolean;
  /** The counted supply S_eff = total shares minus the shares of approved withdrawals. */
  supplyShares: bigint;
  /** Shares of the viewer's active withdrawal request (pending or approved). */
  myLockedShares: bigint;
  /** The viewer's active request, else the newest one closed in the last 14 days. */
  myWithdrawal: MyWithdrawal | null;
}

export type { MyWithdrawal, WithdrawalStatus } from "@/lib/treasury/withdrawals";

export interface RankingEntry {
  rank: number;
  /** Null for a hidden donor (other than the viewer) and for the club fund. */
  memberId: string | null;
  label: string;
  shareBps: number;
  netUsdc: bigint;
  /** The "Fondo del club" row: no member, no contribution of its own. */
  club: boolean;
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

export type NavRange = "24h" | "7d" | "30d" | "all";

export interface NavPoint {
  takenAt: string;
  navUsd6: bigint;
  sharePriceUsd6: bigint;
}

export interface Operation {
  id: string;
  asset: FundAsset;
  direction: "in" | "out";
  amount: bigint;
  /** Null for every inflow a member sees, and for native-ETH changes inferred between snapshots. */
  txHash: string | null;
  occurredAt: string;
  note: string | null;
  /** False only for an outflow with no note ("Sin explicar"). */
  explained: boolean;
}

/** numeric(78,0) as bigint from a JSON string or number; anything else is 0. */
function big(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  return 0n;
}

function composition(v: unknown): Composition | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  return {
    usdcUnits: big(c.usdcUnits),
    ethWei: big(c.ethWei),
    wethWei: big(c.wethWei),
    ethPriceE8: big(c.ethPriceE8),
    priceSource: c.priceSource === "coingecko" ? "coingecko" : "chainlink",
    takenAt: String(c.takenAt),
  };
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
    navUsd6: big(o.navUsd6),
    navAt: typeof o.navAt === "string" ? o.navAt : null,
    sharePriceUsd6: big(o.sharePriceUsd6),
    myValueUsd6: big(o.myValueUsd6),
    clubShares: big(o.clubShares),
    composition: composition(o.composition),
    withdrawalsEnabled: o.withdrawalsEnabled === true,
    supplyShares: big(o.supplyShares),
    myLockedShares: big(o.myLockedShares),
    myWithdrawal: parseMyWithdrawal(o.myWithdrawal),
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
    // A hidden donor comes back as "Anónimo": only the club row has no member id and this label.
    club: typeof r.member_id !== "string" && r.label === "Fondo del club",
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

/** NAV and share price over a range, oldest first (dao_nav_history thins it to at most 500 points). */
export async function getNavHistory(supabase: SupabaseClient, range: NavRange): Promise<NavPoint[]> {
  const { data, error } = await supabase.rpc("dao_nav_history", { p_range: range });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    takenAt: String(r.taken_at),
    navUsd6: big(r.nav_usd6),
    sharePriceUsd6: big(r.share_price_usd6),
  }));
}

const ASSETS = new Set<string>(["USDC", "ETH", "WETH"]);

/** The Safe's operations, newest first, as dao_operations filters them for the viewer (ruling F4a-R5). */
export async function getOperations(supabase: SupabaseClient, limit = 30): Promise<Operation[]> {
  const { data, error } = await supabase.rpc("dao_operations", { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[])
    .filter((r) => ASSETS.has(String(r.asset)) && (r.direction === "in" || r.direction === "out"))
    .map((r) => ({
      id: String(r.id),
      asset: r.asset as FundAsset,
      direction: r.direction as "in" | "out",
      amount: big(r.amount),
      txHash: typeof r.tx_hash === "string" ? r.tx_hash : null,
      occurredAt: String(r.occurred_at),
      note: typeof r.note === "string" ? r.note : null,
      explained: r.explained === true,
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
