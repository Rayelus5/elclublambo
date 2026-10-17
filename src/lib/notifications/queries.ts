// Notification reads. Takes a Supabase client so it runs on the server (first paint) and in the browser (paging,
// realtime refresh). Everything goes through RLS: a notice of a channel/ticket the member cannot see is not returned,
// and the actor, channel name, message excerpt and ticket subject are joined under RLS too (never copied into
// `notifications`). The actor's identity always comes from `members`, never from message content.
import type { SupabaseClient } from "@supabase/supabase-js";
import { shortAddress } from "@/lib/auth/wallet";

export const PAGE_SIZE = 30;
const EXCERPT_CHARS = 140;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Postgres timestamptz as PostgREST returns it; validated because the cursor is spliced into an `or()` filter.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

export type NotificationKind =
  | "mention"
  | "reply"
  | "channel_message"
  | "invite_redeemed"
  | "godchild_banned"
  | "sponsor_penalized"
  | "report_new"
  | "member_review"
  | "ticket_new"
  | "ticket_reply"
  | "ticket_status";

export interface NotificationView {
  id: number;
  kind: NotificationKind;
  createdAt: string;
  readAt: string | null;
  actor: { name: string; wallet: string } | null;
  channelName: string | null;
  excerpt: string | null;
  ticketSubject: string | null;
  /** Only for `ticket_status`: the status the ticket moved to. */
  ticketStatus: "open" | "closed" | null;
  href: string;
}

export type NotificationFilter = "all" | "mentions";
export interface NotificationCursor {
  createdAt: string;
  id: number;
}

interface Row {
  id: number;
  kind: NotificationKind;
  created_at: string;
  read_at: string | null;
  channel_id: string | null;
  ticket_id: string | null;
  data: Record<string, unknown> | null;
  actor: { display_name: string | null; wallet_address: string } | null;
  channel: { name: string } | null;
  message: { body_text: string | null; deleted_at: string | null } | null;
  ticket: { subject: string } | null;
}

const SELECT =
  "id, kind, created_at, read_at, channel_id, ticket_id, data, " +
  "actor:members!notifications_actor_id_fkey(display_name, wallet_address), " +
  "channel:channels(name), message:messages(body_text, deleted_at), ticket:tickets(subject)";

const MESSAGE_KINDS = new Set<NotificationKind>(["mention", "reply", "channel_message"]);
const PERSON_KINDS = new Set<NotificationKind>(["invite_redeemed", "godchild_banned", "sponsor_penalized"]);

function hrefFor(row: Row): string {
  if (MESSAGE_KINDS.has(row.kind) && row.channel_id) {
    const root = row.data?.thread_root_id;
    return `/c/${row.channel_id}${typeof root === "string" && UUID_RE.test(root) ? `?thread=${root}` : ""}`;
  }
  if (PERSON_KINDS.has(row.kind)) return row.actor ? `/u/${row.actor.wallet_address}` : "/notifications";
  if (row.kind === "report_new") return "/moderation/reports";
  if (row.kind === "member_review") return "/admin/members";
  if (row.ticket_id && UUID_RE.test(row.ticket_id)) return `/tickets/${row.ticket_id}`;
  return "/notifications";
}

function toView(row: Row): NotificationView {
  const excerpt =
    row.message && !row.message.deleted_at && row.message.body_text
      ? row.message.body_text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS) || null
      : null;
  const status = row.data?.status;
  return {
    id: row.id,
    kind: row.kind,
    createdAt: row.created_at,
    readAt: row.read_at,
    actor: row.actor
      ? { name: row.actor.display_name?.trim() || shortAddress(row.actor.wallet_address), wallet: row.actor.wallet_address }
      : null,
    channelName: row.channel?.name ?? null,
    excerpt,
    ticketSubject: row.ticket?.subject ?? null,
    ticketStatus: row.kind === "ticket_status" && (status === "open" || status === "closed") ? status : null,
    href: hrefFor(row),
  };
}

export async function listNotifications(
  opts: { cursor?: NotificationCursor; filter: NotificationFilter },
  supabase: SupabaseClient,
): Promise<NotificationView[]> {
  if (opts.cursor && (!TIMESTAMP_RE.test(opts.cursor.createdAt) || !Number.isSafeInteger(opts.cursor.id))) {
    throw new Error("notifications: invalid cursor");
  }
  let query = supabase
    .from("notifications")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);
  if (opts.filter === "mentions") query = query.in("kind", ["mention", "reply"]);
  if (opts.cursor) {
    const { createdAt, id } = opts.cursor;
    query = query.or(`created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${id})`);
  }
  const { data, error } = (await query) as { data: Row[] | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  return (data ?? []).map(toView);
}
