// Withdrawal requests (F4c), isomorphic: parsing of the RPC rows, the member-facing labels and the share / percent
// arithmetic of the "Retirar" form. Shares and USDC are bigint (numeric(78,0) comes back as text); never floats.
import type { SupabaseClient } from "@supabase/supabase-js";

export type WithdrawalStatus = "pending" | "approved" | "paid" | "rejected" | "cancelled";

const STATUSES: readonly WithdrawalStatus[] = ["pending", "approved", "paid", "rejected", "cancelled"];

export interface MyWithdrawal {
  id: string;
  status: WithdrawalStatus;
  shares: bigint;
  /** USDC (6 decimals) fixed at approval; null until approved. */
  amountUsdc: bigint | null;
  approvedAt: string | null;
  /** approvedAt + 14 days: when an unpaid approval lapses. */
  expiresAt: string | null;
  /** The Safe's payout was recorded (it may still await finality). */
  payoutRecorded: boolean;
  payoutTxHash: string | null;
  rejectReason: string | null;
  /** Set when an earlier approval lapsed ("Caducada · pendiente de nueva aprobación" while pending). */
  lastExpiredAt: string | null;
  createdAt: string;
}

/** A treasury_withdrawals row (treasurer panel, active chain), camel-cased; amounts as bigint. */
export interface TreasuryWithdrawal {
  id: string;
  memberId: string;
  /** The member's real label, even when they hide from the ranking (treasurers only). */
  memberLabel: string;
  wallet: string;
  shares: bigint;
  /** The member's whole position, to tell a full withdrawal from a partial one. */
  positionShares: bigint;
  status: WithdrawalStatus;
  createdAt: string;
  approvedAt: string | null;
  expiresAt: string | null;
  approvedByLabel: string | null;
  selfApproved: boolean;
  /** USDC fixed at approval. */
  amountUsdc: bigint | null;
  /** Market estimate (USD6) at the cached NAV over S_eff; null when nobody holds counted shares. */
  estimateUsd6: bigint | null;
  lastExpiredAt: string | null;
  rejectReason: string | null;
  payoutTxHash: string | null;
  payoutAmount: bigint | null;
  payoutRecordedAt: string | null;
  paidAt: string | null;
  /** A Safe outflow is linked as the payout and awaits verification (F4c-R6): rejecting is refused meanwhile. */
  payoutLinked: boolean;
  rejectedAt: string | null;
  cancelledAt: string | null;
}

function big(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  return 0n;
}
const bigOrNull = (v: unknown): bigint | null => (v == null ? null : big(v));
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const statusOf = (v: unknown): WithdrawalStatus | undefined => STATUSES.find((s) => s === v);

/** dao_overview's `myWithdrawal`, or null when absent or malformed. */
export function parseMyWithdrawal(v: unknown): MyWithdrawal | null {
  if (!v || typeof v !== "object") return null;
  const w = v as Record<string, unknown>;
  const status = statusOf(w.status);
  if (!status || typeof w.id !== "string") return null;
  return {
    id: w.id,
    status,
    shares: big(w.shares),
    amountUsdc: bigOrNull(w.amountUsdc),
    approvedAt: strOrNull(w.approvedAt),
    expiresAt: strOrNull(w.expiresAt),
    payoutRecorded: w.payoutRecorded === true,
    payoutTxHash: strOrNull(w.payoutTxHash),
    rejectReason: strOrNull(w.rejectReason),
    lastExpiredAt: strOrNull(w.lastExpiredAt),
    createdAt: String(w.createdAt),
  };
}

/** The member-facing status label (exact copy from the plan). */
export function withdrawalLabel(w: Pick<MyWithdrawal, "status" | "payoutRecorded" | "lastExpiredAt">): string {
  switch (w.status) {
    case "pending":
      return w.lastExpiredAt ? "Caducada · pendiente de nueva aprobación" : "Pendiente";
    case "approved":
      return w.payoutRecorded ? "Pago detectado · esperando finalidad" : "Aprobada";
    case "paid":
      return "Pagada";
    case "rejected":
      return "Rechazada";
    case "cancelled":
      return "Cancelada";
  }
}

/** Open requests and those closed in the last 30 days on the active chain. Throws on an RPC error (forbidden). */
export async function getTreasuryWithdrawals(supabase: SupabaseClient): Promise<TreasuryWithdrawal[]> {
  const { data, error } = await supabase.rpc("treasury_withdrawals");
  if (error) throw new Error(error.message);
  const out: TreasuryWithdrawal[] = [];
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const status = statusOf(r.status);
    if (!status || typeof r.id !== "string") continue;
    out.push({
      id: r.id,
      memberId: String(r.member_id),
      memberLabel: String(r.member_label ?? ""),
      wallet: String(r.wallet ?? ""),
      shares: big(r.shares),
      positionShares: big(r.position_shares),
      status,
      createdAt: String(r.created_at),
      approvedAt: strOrNull(r.approved_at),
      expiresAt: strOrNull(r.expires_at),
      approvedByLabel: strOrNull(r.approved_by_label),
      selfApproved: r.self_approved === true,
      amountUsdc: bigOrNull(r.amount_usdc),
      estimateUsd6: bigOrNull(r.estimate_usd6),
      lastExpiredAt: strOrNull(r.last_expired_at),
      rejectReason: strOrNull(r.reject_reason),
      payoutTxHash: strOrNull(r.payout_tx_hash),
      payoutAmount: bigOrNull(r.payout_amount),
      payoutRecordedAt: strOrNull(r.payout_recorded_at),
      paidAt: strOrNull(r.paid_at),
      payoutLinked: r.payout_linked === true,
      rejectedAt: strOrNull(r.rejected_at),
      cancelledAt: strOrNull(r.cancelled_at),
    });
  }
  return out;
}

const BPS = 10000;

/** The shares for a percentage of the position: every share at 100 % (no dust left behind), else floored. */
export function sharesForBps(myShares: bigint, bps: number): bigint {
  if (bps === BPS) return myShares;
  return (myShares * BigInt(bps)) / BigInt(BPS);
}

/** "12,5" / "12.5" / "12" (up to 2 decimals, in (0, 100]) -> basis points 1..10000; anything else null. */
export function parsePercent(text: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps >= 1 && bps <= BPS ? bps : null;
}

/** USDC (6 decimals) the shares are worth at a share price in USD6 per 10^18 shares, floored. */
export function estimateUsdc(shares: bigint, sharePriceUsd6: bigint): bigint {
  return (shares * sharePriceUsd6) / 10n ** 18n;
}
