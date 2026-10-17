// Ticket reads. They take a Supabase client, so they run on the server (pages) and in the browser (realtime re-reads).
// Everything goes through RLS: a ticket is only returned to its author or to staff with MANAGE_TICKETS in its channel.
import type { SupabaseClient } from "@supabase/supabase-js";
import { shortAddress } from "@/lib/auth/wallet";

const LIMIT = 100;

export type TicketStatus = "open" | "closed";

export interface TicketListItem {
  id: string;
  subject: string;
  status: TicketStatus;
  channelName: string;
  authorName: string;
  lastMessageAt: string;
}

export interface TicketMessageView {
  id: string;
  authorId: string;
  authorName: string;
  /**
   * Written by someone who is not the ticket's author. Only the author and the staff can write in a ticket, so this is
   * the "Staff" label; it needs no permission lookup on other members.
   */
  isStaff: boolean;
  bodyText: string;
  allowLinks: boolean;
  createdAt: string;
}

export interface TicketDetail {
  ticket: { id: string; subject: string; status: TicketStatus; channelId: string; channelName: string; authorId: string; authorName: string };
  messages: TicketMessageView[];
}

interface MemberRow {
  id: string;
  wallet_address: string;
  display_name: string | null;
}

const nameOf = (m: MemberRow | null) => (m ? m.display_name?.trim() || shortAddress(m.wallet_address) : "Miembro");

const AUTHOR = "author:members!tickets_author_id_fkey(id, wallet_address, display_name)";
const MSG_AUTHOR = "author:members!ticket_messages_author_id_fkey(id, wallet_address, display_name)";

interface ListRow {
  id: string;
  subject: string;
  status: TicketStatus;
  last_message_at: string;
  channel: { name: string } | null;
  author: MemberRow | null;
}

/** Tickets of the reader (`mine`) or of other members that the reader supports (`staff`), newest activity first. */
export async function listTickets(
  opts: { scope: "mine" | "staff"; status: TicketStatus },
  supabase: SupabaseClient,
  memberId: string,
): Promise<TicketListItem[]> {
  let query = supabase
    .from("tickets")
    .select(`id, subject, status, last_message_at, channel:channels(name), ${AUTHOR}`)
    .eq("status", opts.status);
  query = opts.scope === "mine" ? query.eq("author_id", memberId) : query.neq("author_id", memberId);
  const { data, error } = (await query.order("last_message_at", { ascending: false }).limit(LIMIT)) as {
    data: ListRow[] | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    subject: r.subject,
    status: r.status,
    channelName: r.channel?.name ?? "canal",
    authorName: nameOf(r.author),
    lastMessageAt: r.last_message_at,
  }));
}

interface MessageRow {
  id: string;
  author_id: string;
  body_text: string;
  allow_links: boolean;
  created_at: string;
  author: MemberRow | null;
}

const toMessage = (r: MessageRow, ticketAuthorId: string): TicketMessageView => ({
  id: r.id,
  authorId: r.author_id,
  authorName: nameOf(r.author),
  isStaff: r.author_id !== ticketAuthorId,
  bodyText: r.body_text,
  allowLinks: r.allow_links,
  createdAt: r.created_at,
});

/** The ticket and its messages, or null when RLS hides it (not yours, or it does not exist). */
export async function getTicket(id: string, supabase: SupabaseClient): Promise<TicketDetail | null> {
  const { data: t, error } = (await supabase
    .from("tickets")
    .select(`id, subject, status, channel_id, author_id, channel:channels(name), ${AUTHOR}`)
    .eq("id", id)
    .maybeSingle()) as {
    data: (ListRow & { channel_id: string; author_id: string }) | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);
  if (!t) return null;
  const { data: rows, error: mErr } = (await supabase
    .from("ticket_messages")
    .select(`id, author_id, body_text, allow_links, created_at, ${MSG_AUTHOR}`)
    .eq("ticket_id", id)
    .order("created_at", { ascending: true })) as { data: MessageRow[] | null; error: { message: string } | null };
  if (mErr) throw new Error(mErr.message);
  return {
    ticket: {
      id: t.id,
      subject: t.subject,
      status: t.status,
      channelId: t.channel_id,
      channelName: t.channel?.name ?? "canal",
      authorId: t.author_id,
      authorName: nameOf(t.author),
    },
    messages: (rows ?? []).map((r) => toMessage(r, t.author_id)),
  };
}

/** Re-reads one message by id (realtime events carry only ids). Null when it is not readable. */
export async function getTicketMessage(supabase: SupabaseClient, id: string): Promise<TicketMessageView | null> {
  const { data, error } = (await supabase
    .from("ticket_messages")
    .select(`id, author_id, body_text, allow_links, created_at, ${MSG_AUTHOR}, ticket:tickets(author_id)`)
    .eq("id", id)
    .maybeSingle()) as { data: (MessageRow & { ticket: { author_id: string } | null }) | null; error: unknown };
  if (error || !data || !data.ticket) return null;
  return toMessage(data, data.ticket.author_id);
}

/** Every message of a ticket in ONE query (used to resync after a gap). */
export async function getTicketMessages(supabase: SupabaseClient, ticketId: string): Promise<TicketMessageView[]> {
  const { data, error } = (await supabase
    .from("ticket_messages")
    .select(`id, author_id, body_text, allow_links, created_at, ${MSG_AUTHOR}, ticket:tickets(author_id)`)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })) as {
    data: Array<MessageRow & { ticket: { author_id: string } | null }> | null;
    error: unknown;
  };
  if (error || !data) return [];
  return data.filter((r) => r.ticket).map((r) => toMessage(r, r.ticket!.author_id));
}

/** Re-reads the status of a ticket. */
export async function getTicketState(supabase: SupabaseClient, id: string): Promise<{ status: TicketStatus } | null> {
  const { data, error } = (await supabase.from("tickets").select("status").eq("id", id).maybeSingle()) as {
    data: { status: TicketStatus } | null;
    error: unknown;
  };
  if (error || !data) return null;
  return { status: data.status };
}
