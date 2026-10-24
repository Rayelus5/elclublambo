// Bounty reads. Every function takes a Supabase client and goes through the Task 2 RPCs, which enforce visibility:
// a bounty in a channel the viewer cannot see never comes back. Amounts come from `amount_text` (numeric(78,0) loses
// digits past 2^53 as a JSON number).
import type { SupabaseClient } from "@supabase/supabase-js";
import { isChainId, type ChainId } from "@/lib/economy/networks";
import type { Token } from "@/lib/payments/amounts";

/**
 * Derived by SQL bounty_status. Precedence (first match wins): cancelled > paid > paid_late > removed >
 * solver_unavailable > unpaid > solution_marked > expired > open. removed (deleted by moderation) and solver_unavailable
 * (solver banned or left) mean the author cannot pay: never an unpaid mark (F3-R1). There is no other_chain: a bounty
 * is paid on any enabled network the solver accepts (P0-R4).
 */
export type BountyStatus =
  | "open"
  | "solution_marked"
  | "unpaid"
  | "paid"
  | "paid_late"
  | "expired"
  | "cancelled"
  | "removed"
  | "solver_unavailable";

const STATUSES: ReadonlySet<string> = new Set<BountyStatus>([
  "open",
  "solution_marked",
  "unpaid",
  "paid",
  "paid_late",
  "expired",
  "cancelled",
  "removed",
  "solver_unavailable",
]);
const isToken = (v: unknown): v is Token => v === "ETH" || v === "USDC";
const isStatus = (v: unknown): v is BountyStatus => typeof v === "string" && STATUSES.has(v);

function units(text: unknown): bigint {
  return typeof text === "string" && /^\d+$/.test(text) ? BigInt(text) : 0n;
}

export interface BountyDetail {
  messageId: string;
  token: Token;
  amount: bigint;
  chainId: ChainId;
  status: BountyStatus;
  solutionMessageId: string | null;
  solverId: string | null;
  solutionMarkedAt: string | null;
  /** solution_marked_at + 7 days; null until a solution is marked. */
  payDeadline: string | null;
  paidTipId: string | null;
}

export interface BountyRecord {
  paid: number;
  paidLate: number;
  unpaid: number;
  open: number;
}

export interface UnpaidBounty {
  messageId: string;
  channelId: string;
  token: Token;
  amount: bigint;
  solutionMarkedAt: string | null;
  /** The announced network (the RPC lists the enabled networks only), shown as a network label. */
  chainId: ChainId;
}

/** Details per bounty message id. Never throws: null means the read FAILED; ids that are not visible bounties are absent. */
export async function getBountyDetails(supabase: SupabaseClient, messageIds: readonly string[]): Promise<Map<string, BountyDetail> | null> {
  const out = new Map<string, BountyDetail>();
  if (messageIds.length === 0) return out;
  try {
    const { data, error } = await supabase.rpc("bounty_details", { p_message_ids: [...messageIds] });
    if (error || !Array.isArray(data)) return null;
    for (const r of data as Array<Record<string, unknown>>) {
      if (!isToken(r.token) || !isChainId(r.chain_id) || !isStatus(r.status) || typeof r.message_id !== "string") continue;
      out.set(r.message_id, {
        messageId: r.message_id,
        token: r.token,
        amount: units(r.amount_text),
        chainId: r.chain_id,
        status: r.status,
        solutionMessageId: (r.solution_message_id as string | null) ?? null,
        solverId: (r.solver_id as string | null) ?? null,
        solutionMarkedAt: (r.solution_marked_at as string | null) ?? null,
        payDeadline: (r.pay_deadline as string | null) ?? null,
        paidTipId: (r.paid_tip_id as string | null) ?? null,
      });
    }
  } catch {
    return null;
  }
  return out;
}

/** Counts of the member's bounties on the enabled networks that the viewer can see. */
export async function getMemberBountyRecord(supabase: SupabaseClient, memberId: string): Promise<BountyRecord> {
  const { data, error } = await supabase.rpc("member_bounty_record", { p_member: memberId });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) as Partial<Record<"paid" | "paid_late" | "unpaid" | "open", unknown>> | null | undefined;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { paid: n(r?.paid), paidLate: n(r?.paid_late), unpaid: n(r?.unpaid), open: n(r?.open) };
}

/** The member's unpaid bounties on the enabled networks that the viewer can see, oldest mark first. */
export async function getMemberUnpaidBounties(supabase: SupabaseClient, memberId: string): Promise<UnpaidBounty[]> {
  const { data, error } = await supabase.rpc("member_unpaid_bounties", { p_member: memberId });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((r): UnpaidBounty[] =>
    isToken(r.token) && typeof r.message_id === "string" && typeof r.channel_id === "string" && isChainId(r.chain_id)
      ? [
          {
            messageId: r.message_id,
            channelId: r.channel_id,
            token: r.token,
            amount: units(r.amount_text),
            solutionMarkedAt: (r.solution_marked_at as string | null) ?? null,
            chainId: r.chain_id,
          },
        ]
      : [],
  );
}
