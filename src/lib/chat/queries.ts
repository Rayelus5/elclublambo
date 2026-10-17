// Chat reads. Every function takes a Supabase client so the same code runs on the server (first paint) and in the
// browser (realtime reconciliation). All of it goes through RLS: what the member cannot see simply is not returned.
import type { SupabaseClient } from "@supabase/supabase-js";
import { shortAddress } from "@/lib/auth/wallet";
import { extractMentions } from "@/lib/chat/content";
import {
  aggregateReactions,
  emptyDirectory,
  type ChatMessage,
  type Directory,
  type MessageAttachment,
  type QuotePreview,
  type ReactionRow,
} from "@/lib/chat/model";

export const PAGE_SIZE = 50;
export const SIGNED_URL_SECONDS = 3600;
const THREAD_LIMIT = 500;
const PINNED_LIMIT = 50;
const QUOTE_CHARS = 140;

interface MessageRow {
  id: string;
  channel_id: string;
  thread_root_id: string | null;
  author_id: string;
  body: unknown;
  allow_links: boolean;
  kind: "text" | "alpha";
  expanded: boolean;
  quoted_message_id: string | null;
  reply_count: number;
  last_reply_at: string | null;
  pinned_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

const COLUMNS =
  "id, channel_id, thread_root_id, author_id, body, allow_links, kind, expanded, quoted_message_id, reply_count, last_reply_at, pinned_at, edited_at, deleted_at, created_at";

export interface Cursor {
  createdAt: string;
  id: string;
}

export interface Hydrated {
  messages: ChatMessage[];
  directory: Directory;
}

const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)];

async function signPaths(supabase: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data, error } = await supabase.storage.from("chat-images").createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error || !data) return out;
  for (const item of data) if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  return out;
}

/**
 * Turns message rows into view models: attachments (signed in one batch), reactions, quote previews, and the
 * directory of authors, mentioned members and mentioned roles (one query each).
 */
export async function hydrateMessages(
  supabase: SupabaseClient,
  rows: readonly MessageRow[],
  meId: string,
): Promise<Hydrated> {
  if (rows.length === 0) return { messages: [], directory: emptyDirectory() };
  const ids = rows.map((r) => r.id);
  const quotedIds = unique(rows.flatMap((r) => (r.quoted_message_id ? [r.quoted_message_id] : [])));

  const alphaIds = rows.filter((r) => r.kind === "alpha" && !r.deleted_at).map((r) => r.id);

  const [attachmentsRes, reactionsRes, quotedRes, alphaRes] = await Promise.all([
    supabase.from("message_attachments").select("id, message_id, storage_path, mime, width, height").in("message_id", ids),
    supabase.from("message_reactions").select("message_id, member_id, emoji, created_at").in("message_id", ids),
    quotedIds.length > 0
      ? supabase.from("messages").select("id, author_id, body_text, deleted_at").in("id", quotedIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    alphaIds.length > 0
      ? supabase.from("alpha_details").select("message_id, contract_address").in("message_id", alphaIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  const alphaByMessage = new Map(
    ((alphaRes.data ?? []) as Array<{ message_id: string; contract_address: string }>).map((a) => [a.message_id, a.contract_address]),
  );

  const attachmentRows = (attachmentsRes.data ?? []) as Array<{
    id: string;
    message_id: string;
    storage_path: string;
    mime: string;
    width: number | null;
    height: number | null;
  }>;
  const quotedRows = (quotedRes.data ?? []) as Array<{
    id: string;
    author_id: string;
    body_text: string;
    deleted_at: string | null;
  }>;

  const mentions = rows.flatMap((r) => (r.deleted_at ? [] : extractMentions(r.body)));
  const memberIds = unique([
    ...rows.map((r) => r.author_id),
    ...quotedRows.map((q) => q.author_id),
    ...mentions.flatMap((m) => (m.kind === "member" && m.id ? [m.id] : [])),
  ]);
  const roleIds = unique(mentions.flatMap((m) => (m.kind === "role" && m.id ? [m.id] : [])));

  const [signed, membersRes, rolesRes] = await Promise.all([
    signPaths(supabase, unique(attachmentRows.map((a) => a.storage_path))),
    supabase.from("members").select("id, display_name, wallet_address").in("id", memberIds),
    roleIds.length > 0
      ? supabase.from("roles").select("id, name, color").in("id", roleIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);

  const directory = emptyDirectory();
  for (const m of (membersRes.data ?? []) as Array<{ id: string; display_name: string | null; wallet_address: string }>) {
    directory.members[m.id] = { name: m.display_name?.trim() || shortAddress(m.wallet_address), walletAddress: m.wallet_address };
  }
  for (const r of (rolesRes.data ?? []) as Array<{ id: string; name: string; color: string }>) {
    directory.roles[r.id] = { name: r.name, color: r.color };
  }

  const signedAt = Date.now();
  const attachmentsByMessage = new Map<string, MessageAttachment[]>();
  for (const a of attachmentRows) {
    const list = attachmentsByMessage.get(a.message_id) ?? [];
    const url = signed.get(a.storage_path) ?? null;
    list.push({ id: a.id, url, ...(url ? { signedAt } : {}), mime: a.mime, width: a.width, height: a.height });
    attachmentsByMessage.set(a.message_id, list);
  }
  const reactions = aggregateReactions((reactionsRes.data ?? []) as ReactionRow[], meId);
  const quotes = new Map<string, QuotePreview>();
  for (const q of quotedRows) {
    quotes.set(q.id, {
      authorName: directory.members[q.author_id]?.name ?? "alguien",
      text: q.body_text.length > QUOTE_CHARS ? `${q.body_text.slice(0, QUOTE_CHARS)}…` : q.body_text,
      deleted: q.deleted_at !== null,
    });
  }

  const messages = rows.map(
    (r): ChatMessage => ({
      id: r.id,
      channelId: r.channel_id,
      threadRootId: r.thread_root_id,
      authorId: r.author_id,
      body: r.body,
      allowLinks: r.allow_links,
      kind: r.kind,
      alphaAddress: r.kind === "alpha" ? (alphaByMessage.get(r.id) ?? null) : null,
      expanded: r.expanded,
      quotedId: r.quoted_message_id,
      quote: r.quoted_message_id ? (quotes.get(r.quoted_message_id) ?? null) : null,
      replyCount: r.reply_count,
      lastReplyAt: r.last_reply_at,
      pinnedAt: r.pinned_at,
      editedAt: r.edited_at,
      deletedAt: r.deleted_at,
      createdAt: r.created_at,
      attachments: attachmentsByMessage.get(r.id) ?? [],
      reactions: reactions.get(r.id) ?? [],
    }),
  );
  return { messages, directory };
}

/** A page of root messages, oldest first. `before` is the (created_at, id) of the oldest message already shown. */
export async function getMessages(
  supabase: SupabaseClient,
  channelId: string,
  meId: string,
  opts: { before?: Cursor; limit?: number } = {},
): Promise<Hydrated & { hasMore: boolean }> {
  const limit = opts.limit ?? PAGE_SIZE;
  let query = supabase
    .from("messages")
    .select(COLUMNS)
    .eq("channel_id", channelId)
    .is("thread_root_id", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (opts.before) {
    const { createdAt, id } = opts.before;
    query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
  }
  const { data, error } = await query.returns<MessageRow[]>();
  if (error) throw error;
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).toReversed();
  return { ...(await hydrateMessages(supabase, page, meId)), hasMore };
}

/** One message by id, or null when it does not exist or the member cannot see it (RLS). */
export async function getMessage(supabase: SupabaseClient, id: string, meId: string): Promise<Hydrated & { message: ChatMessage | null }> {
  const { data, error } = await supabase.from("messages").select(COLUMNS).eq("id", id).maybeSingle<MessageRow>();
  if (error) throw error;
  if (!data) return { message: null, messages: [], directory: emptyDirectory() };
  const hydrated = await hydrateMessages(supabase, [data], meId);
  return { ...hydrated, message: hydrated.messages[0] ?? null };
}

/** A thread: the root and its replies, oldest first. */
export async function getThread(
  supabase: SupabaseClient,
  rootId: string,
  meId: string,
): Promise<{ root: ChatMessage | null; replies: ChatMessage[]; directory: Directory }> {
  const [rootRes, repliesRes] = await Promise.all([
    supabase.from("messages").select(COLUMNS).eq("id", rootId).is("thread_root_id", null).maybeSingle<MessageRow>(),
    supabase
      .from("messages")
      .select(COLUMNS)
      .eq("thread_root_id", rootId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(THREAD_LIMIT)
      .returns<MessageRow[]>(),
  ]);
  if (rootRes.error) throw rootRes.error;
  if (repliesRes.error) throw repliesRes.error;
  if (!rootRes.data) return { root: null, replies: [], directory: emptyDirectory() };
  const { messages, directory } = await hydrateMessages(supabase, [rootRes.data, ...(repliesRes.data ?? [])], meId);
  return { root: messages[0] ?? null, replies: messages.slice(1), directory };
}

/** Pinned root messages, most recently pinned first. */
export async function getPinned(supabase: SupabaseClient, channelId: string, meId: string): Promise<Hydrated> {
  const { data, error } = await supabase
    .from("messages")
    .select(COLUMNS)
    .eq("channel_id", channelId)
    .is("thread_root_id", null)
    .is("deleted_at", null)
    .not("pinned_at", "is", null)
    .order("pinned_at", { ascending: false })
    .limit(PINNED_LIMIT)
    .returns<MessageRow[]>();
  if (error) throw error;
  return hydrateMessages(supabase, data ?? [], meId);
}

