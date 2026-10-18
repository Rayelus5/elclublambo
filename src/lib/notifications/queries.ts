// Notification reads. Takes a Supabase client so it runs on the server (first paint) and in the browser (paging,
// realtime refresh). Everything goes through RLS: a notice of a channel/ticket the member cannot see is not returned,
// and the actor, channel name, message excerpt and ticket subject are joined under RLS too (never copied into
// `notifications`). The actor's identity always comes from `members`, never from message content.
import type { SupabaseClient } from "@supabase/supabase-js";
import { identityFromRow, mentionLabel } from "@/lib/members/name";
import { formatToken } from "@/lib/treasury/format";

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
  | "ticket_status"
  | "tip_received"
  | "bounty_solution"
  | "bounty_paid"
  | "treasury_mismatch"
  | "treasury_outflow";

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
  /** Only for `treasury_outflow`: the amount that left the Safe, formatted ("250 USDC"); null if the payload is malformed. */
  outflow?: string | null;
  href: string;
}

/** `treasury_outflow` data {asset, amount}: validated like the SQL push copy (_push_build), never trusted as is. */
function outflowText(data: Record<string, unknown> | null): string | null {
  const asset = data?.asset;
  const amount = data?.amount;
  if ((asset !== "USDC" && asset !== "ETH" && asset !== "WETH") || typeof amount !== "string" || !/^\d{1,60}$/.test(amount)) return null;
  return formatToken(BigInt(amount), asset);
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
  message_id?: string | null;
  data: Record<string, unknown> | null;
  actor: { display_name: string | null; handle: string | null; avatar_path: string | null; wallet_address: string } | null;
  channel: { name: string } | null;
  message: { body_text: string | null; deleted_at: string | null } | null;
  ticket: { subject: string } | null;
}

const SELECT =
  "id, kind, created_at, read_at, channel_id, ticket_id, message_id, data, " +
  "actor:members!notifications_actor_id_fkey(display_name, handle, avatar_path, wallet_address), " +
  "channel:channels(name), message:messages(body_text, deleted_at), ticket:tickets(subject)";

const MESSAGE_KINDS = new Set<NotificationKind>(["mention", "reply", "channel_message"]);
const PERSON_KINDS = new Set<NotificationKind>(["invite_redeemed", "godchild_banned", "sponsor_penalized"]);

/** A tip notice points at the tipped message (not at the system notice); a reply also names its thread root. */
function tipHref(row: Row): string {
  if (!row.channel_id) return "/notifications";
  const message = row.data?.messageId;
  if (typeof message !== "string" || !UUID_RE.test(message)) return `/c/${row.channel_id}`;
  const root = row.data?.threadRootId;
  const thread = typeof root === "string" && UUID_RE.test(root) && root !== message ? `&thread=${root}` : "";
  return `/c/${row.channel_id}?m=${message}${thread}`;
}

const BOUNTY_KINDS = new Set<NotificationKind>(["bounty_solution", "bounty_paid"]);

/**
 * A bounty notice points at the solution reply inside the bounty thread: the chosen reply (`bounty_solution`, the row's
 * message) or the paid one (`bounty_paid`, `data.messageId`). Without it, at the bounty message itself.
 */
function bountyHref(row: Row): string {
  if (!row.channel_id) return "/notifications";
  const id = (v: unknown) => (typeof v === "string" && UUID_RE.test(v) ? v : null);
  const bounty = id(row.data?.bountyId);
  const target = id(row.data?.messageId) ?? id(row.message_id) ?? bounty;
  if (!target) return `/c/${row.channel_id}`;
  const thread = bounty && bounty !== target ? `&thread=${bounty}` : "";
  return `/c/${row.channel_id}?m=${target}${thread}`;
}

function hrefFor(row: Row): string {
  if (row.kind === "tip_received") return tipHref(row);
  if (BOUNTY_KINDS.has(row.kind)) return bountyHref(row);
  if (MESSAGE_KINDS.has(row.kind) && row.channel_id) {
    const root = row.data?.thread_root_id;
    const thread = typeof root === "string" && UUID_RE.test(root) ? root : null;
    // Jump to (and highlight) the exact message; `h` (the notification id) makes a repeated click jump again.
    if (row.message_id && UUID_RE.test(row.message_id)) {
      return `/c/${row.channel_id}?m=${row.message_id}${thread ? `&thread=${thread}` : ""}&h=n${row.id}`;
    }
    return `/c/${row.channel_id}${thread ? `?thread=${thread}` : ""}`;
  }
  if (PERSON_KINDS.has(row.kind)) return row.actor ? `/u/${row.actor.wallet_address}` : "/notifications";
  if (row.kind === "report_new") return "/moderation/reports";
  if (row.kind === "member_review") return "/admin/members";
  if (row.kind === "treasury_mismatch") return "/dao";
  // Ruling F4a-R1: /dao/tesoreria arrives with F4c; until then the operations section of /dao (same url as the push).
  if (row.kind === "treasury_outflow") return "/dao#operaciones";
  if (row.ticket_id && UUID_RE.test(row.ticket_id)) return `/tickets/${row.ticket_id}`;
  return "/notifications";
}

function toView(row: Row): NotificationView {
  // The joined message of a tip is the system notice: the copy already says it, so no excerpt.
  const excerpt =
    row.kind !== "tip_received" && !BOUNTY_KINDS.has(row.kind) && row.message && !row.message.deleted_at && row.message.body_text
      ? row.message.body_text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS) || null
      : null;
  const status = row.data?.status;
  return {
    id: row.id,
    kind: row.kind,
    createdAt: row.created_at,
    readAt: row.read_at,
    actor: row.actor
      ? { name: mentionLabel(identityFromRow(row.actor)), wallet: row.actor.wallet_address }
      : null,
    channelName: row.channel?.name ?? null,
    excerpt,
    ticketSubject: row.ticket?.subject ?? null,
    ticketStatus: row.kind === "ticket_status" && (status === "open" || status === "closed") ? status : null,
    ...(row.kind === "treasury_outflow" ? { outflow: outflowText(row.data) } : {}),
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
