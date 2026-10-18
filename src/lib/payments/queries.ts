// Tip reads. Every function takes a Supabase client (server first paint and browser refetch alike) and goes through
// the Task 1 RPCs, which enforce visibility and anonymity: a donor id only comes back for a public tip or for the
// caller's own. Amounts are read from the `*_text` columns because numeric(78,0) travels as a JSON number and loses
// digits past 2^53 in JavaScript.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isChainId, type ChainId } from "@/lib/economy/networks";
import { identityFromRow, memberName, MEMBER_IDENTITY_COLUMNS, type MemberIdentityRow } from "@/lib/members/name";
import type { Token } from "@/lib/payments/amounts";

export interface TipTotal {
  token: Token;
  total: bigint;
  count: number;
}

export interface TipEntry {
  tipId: string;
  /** Null when the tip is anonymous and the viewer is not the donor. */
  donorName: string | null;
  isMe: boolean;
  anonymous: boolean;
  token: Token;
  amount: bigint;
  chainId: ChainId;
  txHash: string;
  createdAt: string;
}

export interface TipNoticeLink {
  chainId: ChainId;
  txHash: string;
}

/** USDC first, then ETH. */
const TOKEN_ORDER: Record<Token, number> = { USDC: 0, ETH: 1 };

const isToken = (v: unknown): v is Token => v === "ETH" || v === "USDC";

function units(text: unknown, fallback: unknown): bigint {
  try {
    if (typeof text === "string" && /^\d+$/.test(text)) return BigInt(text);
    if (typeof fallback === "number" && Number.isSafeInteger(fallback)) return BigInt(fallback);
  } catch {
    // fall through
  }
  return 0n;
}

/** Totals per message, tokens ordered USDC then ETH. Never throws: a failed read just shows no badge. */
export async function getTipSummaries(supabase: SupabaseClient, messageIds: readonly string[]): Promise<Map<string, TipTotal[]>> {
  const out = new Map<string, TipTotal[]>();
  if (messageIds.length === 0) return out;
  try {
    const { data, error } = await supabase.rpc("tips_summary", { p_message_ids: [...messageIds] });
    if (error || !Array.isArray(data)) return out;
    for (const r of data as Array<{ message_id: string; token: unknown; total: unknown; total_text?: unknown; tip_count: number }>) {
      if (!isToken(r.token)) continue;
      const list = out.get(r.message_id) ?? [];
      list.push({ token: r.token, total: units(r.total_text, r.total), count: Number(r.tip_count) });
      out.set(r.message_id, list);
    }
    for (const list of out.values()) list.sort((a, b) => TOKEN_ORDER[a.token] - TOKEN_ORDER[b.token]);
  } catch {
    return new Map();
  }
  return out;
}

interface TipRow {
  tip_id: string;
  donor_id: string | null;
  is_me: boolean;
  anonymous?: boolean;
  token: unknown;
  amount: unknown;
  amount_text?: unknown;
  chain_id: number;
  main_tx_hash: string;
  created_at: string;
}

async function toEntries(supabase: SupabaseClient, rows: readonly TipRow[]): Promise<TipEntry[]> {
  const donorIds = [...new Set(rows.flatMap((r) => (r.donor_id ? [r.donor_id] : [])))];
  const names = new Map<string, string>();
  if (donorIds.length > 0) {
    const { data } = await supabase.from("members").select(`id, ${MEMBER_IDENTITY_COLUMNS}`).in("id", donorIds);
    for (const m of (data ?? []) as Array<{ id: string } & MemberIdentityRow>) names.set(m.id, memberName(identityFromRow(m)));
  }
  return rows.flatMap((r): TipEntry[] =>
    isToken(r.token) && isChainId(r.chain_id)
      ? [
          {
            tipId: r.tip_id,
            donorName: r.donor_id ? (names.get(r.donor_id) ?? null) : null,
            isMe: r.is_me,
            anonymous: r.anonymous === true,
            token: r.token,
            amount: units(r.amount_text, r.amount),
            chainId: r.chain_id,
            txHash: r.main_tx_hash,
            createdAt: r.created_at,
          },
        ]
      : [],
  );
}

/** The donors of one message, newest first. */
export async function getMessageTips(supabase: SupabaseClient, messageId: string): Promise<TipEntry[]> {
  const { data, error } = await supabase.rpc("message_tips", { p_message_id: messageId });
  if (error) throw error;
  return toEntries(supabase, (data ?? []) as TipRow[]);
}

/** Tips received by a member (profile tips and tips on visible messages), newest first. */
export async function getMemberTips(supabase: SupabaseClient, memberId: string, limit = 20): Promise<TipEntry[]> {
  const { data, error } = await supabase.rpc("member_tips", { p_member: memberId, p_limit: limit });
  if (error) throw error;
  return toEntries(supabase, (data ?? []) as TipRow[]);
}

/** The transaction behind each system notice (by tip id), for the explorer link. Never throws. */
export async function getTipNoticeLinks(supabase: SupabaseClient, tipIds: readonly string[]): Promise<Map<string, TipNoticeLink>> {
  const out = new Map<string, TipNoticeLink>();
  if (tipIds.length === 0) return out;
  try {
    const { data, error } = await supabase.rpc("tips_by_ids", { p_tip_ids: [...tipIds] });
    if (error || !Array.isArray(data)) return out;
    for (const r of data as Array<{ tip_id: string; chain_id: number; main_tx_hash: string }>) {
      if (isChainId(r.chain_id)) out.set(r.tip_id, { chainId: r.chain_id, txHash: r.main_tx_hash });
    }
  } catch {
    return new Map();
  }
  return out;
}

/** "Anónimo" for someone else's anonymous tip, "Tú (anónimo)" / "Tú" for the viewer's own, otherwise the donor's name. */
export function donorLabel(e: Pick<TipEntry, "donorName" | "isMe" | "anonymous">): string {
  if (e.isMe) return e.anonymous ? "Tú (anónimo)" : "Tú";
  return e.donorName ?? "Anónimo";
}
