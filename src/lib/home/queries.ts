// Home summary and right-rail reads. Every list comes from a definer RPC that only returns what the caller may see
// (supabase/migrations/20261019000003_home_and_rail.sql, 20261024200007_home_dashboard.sql); amounts arrive as text and
// become bigint here.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Token } from "@/lib/payments/amounts";

type Client = Pick<SupabaseClient, "rpc" | "from">;
type Row = Record<string, unknown>;

export interface HomeBounty {
  messageId: string;
  channelId: string;
  channelName: string;
  token: Token;
  amount: bigint;
  status: "open" | "solution_marked";
  excerpt: string;
  createdAt: string;
}

export interface HomePin {
  messageId: string;
  channelId: string;
  channelName: string;
  authorLabel: string | null;
  excerpt: string;
  pinnedAt: string;
}

export interface ActiveChannel {
  channelId: string;
  channelName: string;
  lastAt: string;
  recentCount: number;
}

export interface ActivityItem {
  kind: "tip" | "donation" | "bounty";
  at: string;
  actorLabel: string;
  targetLabel: string | null;
  token: Token;
  amount: bigint;
  channelId: string | null;
  messageId: string | null;
  targetWallet: string | null;
}

export interface HomeUnreadChannel {
  channelId: string;
  channelName: string;
  /** Capped at 99 by the RPC. */
  unreadCount: number;
  lastExcerpt: string;
  lastAuthor: string;
  lastAt: string;
}

export interface HomeHighlights {
  openBounties: number;
  poll: { messageId: string; channelId: string; question: string; closesAt: string } | null;
  giveaway: { id: string; title: string; closesAt: string; iEntered: boolean } | null;
  donor: { isMecenas: boolean };
}

export interface UnreadSummary {
  mentions: number;
  replies: number;
  total: number;
}

const big = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const token = (v: unknown): Token => (v === "ETH" ? "ETH" : "USDC");

async function rows(supabase: Client, fn: string, args: Record<string, unknown>): Promise<Row[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

export async function getOpenBounties(supabase: Client, limit = 5, channelId?: string): Promise<HomeBounty[]> {
  const args = channelId ? { p_limit: limit, p_channel: channelId } : { p_limit: limit };
  return (await rows(supabase, "home_open_bounties", args)).map((r) => ({
    messageId: str(r.message_id),
    channelId: str(r.channel_id),
    channelName: str(r.channel_name),
    token: token(r.token),
    amount: big(r.amount_text),
    status: r.status === "solution_marked" ? "solution_marked" : "open",
    excerpt: str(r.excerpt),
    createdAt: str(r.created_at),
  }));
}

export async function getHomePins(supabase: Client, limit = 5, channelId?: string): Promise<HomePin[]> {
  const args = channelId ? { p_limit: limit, p_channel: channelId } : { p_limit: limit };
  return (await rows(supabase, "home_pinned", args)).map((r) => ({
    messageId: str(r.message_id),
    channelId: str(r.channel_id),
    channelName: str(r.channel_name),
    authorLabel: strOrNull(r.author_label),
    excerpt: str(r.excerpt),
    pinnedAt: str(r.pinned_at),
  }));
}

export async function getActiveChannels(supabase: Client, limit = 6): Promise<ActiveChannel[]> {
  return (await rows(supabase, "home_active_channels", { p_limit: limit })).map((r) => ({
    channelId: str(r.channel_id),
    channelName: str(r.channel_name),
    lastAt: str(r.last_at),
    recentCount: Number(r.recent_count ?? 0),
  }));
}

export async function getClubActivity(supabase: Client, limit = 15): Promise<ActivityItem[]> {
  return (await rows(supabase, "club_activity", { p_limit: limit }))
    .filter((r) => r.kind === "tip" || r.kind === "donation" || r.kind === "bounty")
    .map((r) => ({
      kind: r.kind as ActivityItem["kind"],
      at: str(r.at),
      actorLabel: str(r.actor_label) || "Anónimo",
      targetLabel: strOrNull(r.target_label),
      token: token(r.token),
      amount: big(r.amount_text),
      channelId: strOrNull(r.channel_id),
      messageId: strOrNull(r.message_id),
      targetWallet: strOrNull(r.target_wallet),
    }));
}

/** Visible channels with messages from others since the member last read them, newest first. */
export async function getHomeUnreadChannels(supabase: Client, limit = 6): Promise<HomeUnreadChannel[]> {
  return (await rows(supabase, "home_unread_channels", { p_limit: limit })).map((r) => ({
    channelId: str(r.channel_id),
    channelName: str(r.channel_name),
    unreadCount: Number(r.unread_count ?? 0),
    lastExcerpt: str(r.last_excerpt),
    lastAuthor: str(r.last_author),
    lastAt: str(r.last_at),
  }));
}

const obj = (v: unknown): Row | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null);

/** Open bounties count, the newest open poll, the open giveaway closing first and the Mecenas flag. */
export async function getHomeHighlights(supabase: Client): Promise<HomeHighlights> {
  const { data, error } = await supabase.rpc("home_highlights");
  if (error) throw new Error(error.message);
  const o = obj(data) ?? {};
  const poll = obj(o.poll);
  const giveaway = obj(o.giveaway);
  return {
    openBounties: typeof o.openBounties === "number" ? o.openBounties : 0,
    poll: poll
      ? { messageId: str(poll.messageId), channelId: str(poll.channelId), question: str(poll.question), closesAt: str(poll.closesAt) }
      : null,
    giveaway: giveaway
      ? { id: str(giveaway.id), title: str(giveaway.title), closesAt: str(giveaway.closesAt), iEntered: giveaway.iEntered === true }
      : null,
    donor: { isMecenas: obj(o.donor)?.isMecenas === true },
  };
}

/** Unread mentions and replies (RLS: own rows in visible channels only). Errors read as zero: a summary, not a gate. */
export async function getUnreadSummary(supabase: Client): Promise<UnreadSummary> {
  const count = async (kinds: string[] | null) => {
    let q = supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
    if (kinds) q = q.in("kind", kinds);
    const { count: n, error } = await q;
    return error ? 0 : (n ?? 0);
  };
  const [mentions, replies, total] = await Promise.all([count(["mention"]), count(["reply"]), count(null)]);
  return { mentions, replies, total };
}

/** Deep link to a message in its channel. */
export const messageHref = (channelId: string, messageId: string) => `/c/${channelId}?m=${messageId}`;

export interface ChannelOverview {
  name: string;
  topic: string | null;
}

/** One channel for the rail; null when the member cannot view it (missing, hidden or DAO-locked). */
export async function getChannelOverview(supabase: Client, channelId: string): Promise<ChannelOverview | null> {
  const { data, error } = await supabase.rpc("channel_overview", { p_channel: channelId });
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) return null;
  const o = data as Row;
  return { name: str(o.name), topic: strOrNull(o.topic) };
}
