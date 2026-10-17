import type { SupabaseClient } from "@supabase/supabase-js";
import { shortAddress } from "@/lib/auth/wallet";

// Both RPCs are SECURITY INVOKER: call them with the user's own (browser) client so RLS decides what is visible.

export type MessageHit = {
  id: string;
  channelId: string;
  threadRootId: string | null;
  authorId: string;
  authorName: string;
  createdAt: string;
  snippet: string;
};

export type MemberHit = { id: string; displayName: string | null; walletAddress: string };

type MessageRow = {
  id: string;
  channel_id: string;
  thread_root_id: string | null;
  author_id: string;
  created_at: string;
  snippet: string;
};

export async function searchMessages(
  supabase: SupabaseClient,
  q: string,
  opts: { limit?: number; channel?: string } = {},
): Promise<MessageHit[]> {
  const { data, error } = await supabase.rpc("search_messages", {
    p_q: q,
    p_limit: opts.limit ?? 20,
    p_channel: opts.channel ?? null,
  });
  if (error) throw error;
  const rows = (data ?? []) as MessageRow[];
  if (rows.length === 0) return [];

  // Author names under the same RLS; an author that cannot be read falls back to "alguien".
  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const { data: members } = await supabase.from("members").select("id, display_name, wallet_address").in("id", authorIds);
  const names = new Map<string, string>();
  for (const m of (members ?? []) as Array<{ id: string; display_name: string | null; wallet_address: string }>) {
    names.set(m.id, m.display_name?.trim() || shortAddress(m.wallet_address));
  }
  return rows.map((r) => ({
    id: r.id,
    channelId: r.channel_id,
    threadRootId: r.thread_root_id,
    authorId: r.author_id,
    authorName: names.get(r.author_id) ?? "alguien",
    createdAt: r.created_at,
    snippet: r.snippet,
  }));
}

export async function searchMembers(supabase: SupabaseClient, q: string): Promise<MemberHit[]> {
  const { data, error } = await supabase.rpc("search_members", { p_q: q });
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; display_name: string | null; wallet_address: string }>).map((m) => ({
    id: m.id,
    displayName: m.display_name,
    walletAddress: m.wallet_address,
  }));
}
