// Raffles (F4d), isomorphic: parsing of the raffle RPCs, the member-facing status labels and the prize amounts.
// Prizes keep their token (USDC 6 decimals, WETH 18); amounts and weights are bigint (numeric(78,0) comes back as
// text); never floats.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isChainId, type ChainId } from "@/lib/economy/networks";
import { parseAmount } from "@/lib/payments/amounts";
import { formatToken } from "@/lib/treasury/format";

export type RaffleStatus = "open" | "closed" | "drawn" | "paid" | "cancelled" | "void";
export type PrizeToken = "USDC" | "WETH";
export type RaffleMode = "equal" | "weighted";

const STATUSES: readonly RaffleStatus[] = ["open", "closed", "drawn", "paid", "cancelled", "void"];
const TOKENS: readonly PrizeToken[] = ["USDC", "WETH"];
const MODES: readonly RaffleMode[] = ["equal", "weighted"];

export interface RaffleCard {
  id: string;
  title: string;
  prizeToken: PrizeToken;
  prizeAmount: bigint;
  mode: RaffleMode;
  closesAt: string;
  status: RaffleStatus;
  entries: number;
  iEntered: boolean;
  /** The viewer's weight, set at close; null before the close or without an entry. */
  myWeight: bigint | null;
  totalWeight: bigint | null;
  /** keccak256(seed), published at creation. */
  commit: string;
  /** The seed, only once drawn or void. */
  seedReveal: string | null;
  drawBlockNumber: bigint | null;
  /** The viewer's own label, the real one when visible in the ranking, else "Anónimo"; null without a winner. */
  winnerLabel: string | null;
  iWon: boolean;
  /** Drawn, unpaid, more than 14 days after the draw (derived in SQL). */
  unpaid: boolean;
  /** Paid with a payout block more than 14 days after the draw. */
  paidLate: boolean;
  /** A payout is recorded (it may still await finality). */
  payoutRecorded: boolean;
  cancelReason: string | null;
  createdAt: string;
}

export interface RaffleEntry {
  /** 1-based, set at close (null while open). */
  position: number | null;
  /** The viewer's own label, a visible member's label, or "Anónimo #n". */
  label: string;
  weight: bigint | null;
  isMe: boolean;
}

export interface RaffleDetail extends RaffleCard {
  chainId: ChainId;
  drawBlockHash: string | null;
  drawBlockTime: string | null;
  /** The parent block's time: the verifier checks parent ≤ closesAt < draw block time. */
  drawParentBlockTime: string | null;
  drawRandom: bigint | null;
  winnerPosition: number | null;
  /** Only for treasurers and the winner. */
  payoutTxHash: string | null;
  entryList: RaffleEntry[];
}

/** A treasury_raffles row (treasurer panel, active chain), camel-cased; amounts and weights as bigint. */
export interface TreasuryRaffle {
  id: string;
  title: string;
  status: RaffleStatus;
  prizeToken: PrizeToken;
  prizeAmount: bigint;
  /** The prize's USD value at creation (USD6), what left the cached NAV. */
  prizeValueUsd6: bigint;
  mode: RaffleMode;
  closesAt: string;
  entries: number;
  totalWeight: bigint | null;
  winnerMemberId: string | null;
  /** The winner's real label (treasurers pay this member). */
  winnerLabel: string | null;
  /** The winner's login wallet snapshotted at the draw: where the prize goes. */
  winnerAddress: string | null;
  drawnAt: string | null;
  unpaid: boolean;
  payoutTxHash: string | null;
  payoutRecordedAt: string | null;
  paidAt: string | null;
  cancelReason: string | null;
  createdByLabel: string | null;
  createdAt: string;
}

function big(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  return null;
}
const bigOrNull = (v: unknown): bigint | null => (v == null ? null : big(v));
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => list.find((x) => x === v);

/** The member-facing status label (exact copy from the plan). */
export function raffleStatusLabel(r: Pick<RaffleCard, "status" | "payoutRecorded" | "unpaid" | "paidLate">): string {
  switch (r.status) {
    case "open":
      return "Abierto";
    case "closed":
      return "Cerrado · esperando el bloque del sorteo";
    case "drawn":
      if (r.payoutRecorded) return "Pago detectado · esperando finalidad";
      return r.unpaid ? "Impagado · más de 14 días sin pagar" : "Resuelto · pendiente de pago";
    case "paid":
      return r.paidLate ? "Pagado con retraso" : "Pagado";
    case "cancelled":
      return "Cancelado";
    case "void":
      return "Sin ganador";
  }
}

/** Base units -> "10 USDC" / "0,01 WETH" (exact, decimal comma, thousands grouped). */
export function formatPrize(amount: bigint, token: PrizeToken): string {
  return formatToken(amount, token);
}

/** "0,001" / "12.5" -> base units (6 decimals for USDC, 18 for WETH); null when malformed or too precise. */
export function parsePrize(text: string, token: PrizeToken): bigint | null {
  return parseAmount(text, token === "USDC" ? "USDC" : "ETH");
}

/** One dao_raffles card, or null when malformed. */
export function parseRaffleCard(v: unknown): RaffleCard | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const status = pick(STATUSES, r.status);
  const prizeToken = pick(TOKENS, r.prizeToken);
  const mode = pick(MODES, r.mode);
  const prizeAmount = big(r.prizeAmount);
  if (typeof r.id !== "string" || !status || !prizeToken || !mode || prizeAmount === null) return null;
  return {
    id: r.id,
    title: String(r.title ?? ""),
    prizeToken,
    prizeAmount,
    mode,
    closesAt: String(r.closesAt ?? ""),
    status,
    entries: intOrNull(r.entries) ?? 0,
    iEntered: r.iEntered === true,
    myWeight: bigOrNull(r.myWeight),
    totalWeight: bigOrNull(r.totalWeight),
    commit: String(r.commit ?? ""),
    seedReveal: strOrNull(r.seedReveal),
    drawBlockNumber: bigOrNull(r.drawBlockNumber),
    winnerLabel: strOrNull(r.winnerLabel),
    iWon: r.iWon === true,
    unpaid: r.unpaid === true,
    paidLate: r.paidLate === true,
    payoutRecorded: r.payoutRecorded === true,
    cancelReason: strOrNull(r.cancelReason),
    createdAt: String(r.createdAt ?? ""),
  };
}

function parseEntry(v: unknown): RaffleEntry | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  return { position: intOrNull(e.position), label: String(e.label ?? ""), weight: bigOrNull(e.weight), isMe: e.isMe === true };
}

/** A raffle_detail payload, or null when malformed. */
export function parseRaffleDetail(v: unknown): RaffleDetail | null {
  const card = parseRaffleCard(v);
  if (!card) return null;
  const r = v as Record<string, unknown>;
  const chainId = Number(r.chainId);
  if (!isChainId(chainId)) return null;
  return {
    ...card,
    chainId,
    drawBlockHash: strOrNull(r.drawBlockHash),
    drawBlockTime: strOrNull(r.drawBlockTime),
    drawParentBlockTime: strOrNull(r.drawParentBlockTime),
    drawRandom: bigOrNull(r.drawRandom),
    winnerPosition: intOrNull(r.winnerPosition),
    payoutTxHash: strOrNull(r.payoutTxHash),
    entryList: (Array.isArray(r.entryList) ? r.entryList : []).map(parseEntry).filter((e): e is RaffleEntry => e !== null),
  };
}

type Rpc = Pick<SupabaseClient, "rpc">;

/** Active raffles of the active chain, then up to `limit` past ones. Throws on an RPC error. */
export async function getDaoRaffles(supabase: Rpc, limit?: number): Promise<RaffleCard[]> {
  const { data, error } = await supabase.rpc("dao_raffles", limit === undefined ? {} : { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map(parseRaffleCard).filter((r): r is RaffleCard => r !== null);
}

/** One raffle with its draw inputs and entry list; null when it does not exist on the active chain. */
export async function getRaffleDetail(supabase: Rpc, id: string): Promise<RaffleDetail | null> {
  const { data, error } = await supabase.rpc("raffle_detail", { p_raffle: id });
  if (error) {
    if (error.message === "not_found") return null;
    throw new Error(error.message);
  }
  return parseRaffleDetail(data);
}

/** Live raffles and those ended in the last 30 days (treasurers). Throws on an RPC error (forbidden). */
export async function getTreasuryRaffles(supabase: Rpc): Promise<TreasuryRaffle[]> {
  const { data, error } = await supabase.rpc("treasury_raffles");
  if (error) throw new Error(error.message);
  const out: TreasuryRaffle[] = [];
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const status = pick(STATUSES, r.status);
    const prizeToken = pick(TOKENS, r.prize_token);
    const mode = pick(MODES, r.mode);
    const prizeAmount = big(r.prize_amount);
    if (typeof r.id !== "string" || !status || !prizeToken || !mode || prizeAmount === null) continue;
    out.push({
      id: r.id,
      title: String(r.title ?? ""),
      status,
      prizeToken,
      prizeAmount,
      prizeValueUsd6: big(r.prize_value_usd6) ?? 0n,
      mode,
      closesAt: String(r.closes_at ?? ""),
      entries: intOrNull(r.entries) ?? 0,
      totalWeight: bigOrNull(r.total_weight),
      winnerMemberId: strOrNull(r.winner_member_id),
      winnerLabel: strOrNull(r.winner_label),
      winnerAddress: strOrNull(r.winner_address),
      drawnAt: strOrNull(r.drawn_at),
      unpaid: r.unpaid === true,
      payoutTxHash: strOrNull(r.payout_tx_hash),
      payoutRecordedAt: strOrNull(r.payout_recorded_at),
      paidAt: strOrNull(r.paid_at),
      cancelReason: strOrNull(r.cancel_reason),
      createdByLabel: strOrNull(r.created_by_label),
      createdAt: String(r.created_at ?? ""),
    });
  }
  return out;
}
