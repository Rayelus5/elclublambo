// View model of the chat and the pure helpers around it (no React, no Supabase): usable on server and client.
import type { BountyDetail } from "@/lib/bounties/queries";
import type { MemberIdentity } from "@/lib/members/name";
import type { TipNoticeLink, TipTotal } from "@/lib/payments/queries";
import type { PollDetail } from "@/lib/polls/polls";

/** A contract address as the Alpha flow accepts it (the database stores it lowercased). */
export const ALPHA_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface MessageAttachment {
  id: string;
  /** Signed URL (1 h); null when signing failed. */
  url: string | null;
  /** When the URL was signed (ms since epoch); lets a resync reuse it only while it is clearly still valid. */
  signedAt?: number;
  mime: string;
  width: number | null;
  height: number | null;
}

export interface ReactionChip {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface QuotePreview {
  authorName: string;
  text: string;
  deleted: boolean;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  threadRootId: string | null;
  /** Null for a system notice (kind "system"). */
  authorId: string | null;
  /** Raw Tiptap JSON as stored (untrusted: MessageContent sanitizes it). */
  body: unknown;
  allowLinks: boolean;
  kind: "text" | "alpha" | "system" | "bounty" | "poll";
  /** Contract of an Alpha message (lowercase address) and its network; null for ordinary messages. */
  alpha: { address: string; chainId: number } | null;
  /** Details of a bounty message; null when unreadable or not a bounty. Absent on view models built before bounties. */
  bounty?: BountyDetail | null;
  /** Details of a poll message; null when unreadable or not a poll. Absent on view models built before polls. */
  poll?: PollDetail | null;
  expanded: boolean;
  quotedId: string | null;
  quote: QuotePreview | null;
  replyCount: number;
  lastReplyAt: string | null;
  pinnedAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  /** Kept as the raw PostgREST string: it is the (created_at, id) pagination cursor, microseconds included. */
  createdAt: string;
  /**
   * The key of the author's optimistic send (`messages.client_id`): the pending row with that key is this message.
   * Absent on view models built before T-004 and null for messages sent without one.
   */
  clientId?: string | null;
  attachments: MessageAttachment[];
  reactions: ReactionChip[];
  /** Tip totals per token (USDC then ETH); empty when nobody tipped it. */
  tips: TipTotal[];
  /** For a system notice: the tip it announces. */
  tipId: string | null;
  /** For a system notice: the transaction behind it (explorer link); null when unknown. */
  tipLink: TipNoticeLink | null;
}

/** `nameColor`: the colour of the member's highest coloured role (chat author names), when there is one. */
export type DirectoryMember = MemberIdentity & { name: string; nameColor?: string | null };

/** Names needed to render messages: authors and everything referenced by mentions. */
export interface Directory {
  members: Record<string, DirectoryMember>;
  roles: Record<string, { name: string; color: string }>;
}

export const emptyDirectory = (): Directory => ({ members: {}, roles: {} });

export function mergeDirectory(a: Directory, b: Directory): Directory {
  return { members: { ...a.members, ...b.members }, roles: { ...a.roles, ...b.roles } };
}

export interface ViewerPermissions {
  memberId: string;
  canPost: boolean;
  canThread: boolean;
  canManage: boolean;
  canAttach: boolean;
  canMentionEveryone: boolean;
  canReact: boolean;
  /** EMBED_LINKS: needed (with the channel's alpha_enabled) to post Alpha theses. */
  canEmbed?: boolean;
  /** CREATE_BOUNTIES (with SEND_MESSAGES, checked where it is used): /bounty opens the bounty dialog. */
  canBounty?: boolean;
  /** CREATE_POLLS (with SEND_MESSAGES): /encuesta opens the poll dialog. */
  canPoll?: boolean;
}

// --- reactions ------------------------------------------------------------------------------------

export interface ReactionRow {
  message_id: string;
  member_id: string;
  emoji: string;
  created_at: string;
}

/** Per message, one chip per emoji in order of first appearance. */
export function aggregateReactions(rows: readonly ReactionRow[], meId: string): Map<string, ReactionChip[]> {
  const sorted = rows.toSorted((a, b) => cmpTime(a.created_at, b.created_at));
  const out = new Map<string, ReactionChip[]>();
  for (const r of sorted) {
    const chips = out.get(r.message_id) ?? [];
    let chip = chips.find((c) => c.emoji === r.emoji);
    if (!chip) {
      chip = { emoji: r.emoji, count: 0, reactedByMe: false };
      chips.push(chip);
    }
    chip.count += 1;
    if (r.member_id === meId) chip.reactedByMe = true;
    out.set(r.message_id, chips);
  }
  return out;
}

/** Optimistic result of toggling my reaction. */
export function applyReactionToggle(chips: readonly ReactionChip[], emoji: string): ReactionChip[] {
  const existing = chips.find((c) => c.emoji === emoji);
  if (!existing) return [...chips, { emoji, count: 1, reactedByMe: true }];
  if (existing.reactedByMe) {
    return chips.flatMap((c) => (c.emoji !== emoji ? [c] : c.count <= 1 ? [] : [{ ...c, count: c.count - 1, reactedByMe: false }]));
  }
  return chips.map((c) => (c.emoji === emoji ? { ...c, count: c.count + 1, reactedByMe: true } : c));
}

// --- ordering -------------------------------------------------------------------------------------

/** Orders PostgREST timestamps: by instant, then lexically for sub-millisecond differences. */
export function cmpTime(a: string, b: string): number {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (da !== db) return da - db;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function cmpMessages(a: ChatMessage, b: ChatMessage): number {
  return cmpTime(a.createdAt, b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Replaces the message with the same id, or inserts it in (created_at, id) order. */
export function upsertSorted(list: readonly ChatMessage[], message: ChatMessage): ChatMessage[] {
  const at = list.findIndex((m) => m.id === message.id);
  if (at >= 0) return list.map((m, i) => (i === at ? message : m));
  const out = [...list, message];
  out.sort(cmpMessages);
  return out;
}

export function removeById(list: readonly ChatMessage[], id: string): ChatMessage[] {
  return list.some((m) => m.id === id) ? list.filter((m) => m.id !== id) : [...list];
}

// --- list presentation ----------------------------------------------------------------------------

export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** True when `cur` continues the run started by `prev` (same author, under 5 minutes, nothing special). */
export function isGrouped(prev: ChatMessage | undefined, cur: ChatMessage): boolean {
  if (!prev || prev.authorId === null || prev.authorId !== cur.authorId) return false;
  if (prev.deletedAt || cur.deletedAt || cur.quotedId) return false;
  return Date.parse(cur.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
}

/** Index of the first message newer than the read mark and written by someone else; -1 if none. */
export function firstUnreadIndex(list: readonly ChatMessage[], lastReadAt: string | null, meId: string): number {
  if (!lastReadAt) return -1;
  return list.findIndex((m) => m.authorId !== meId && !m.deletedAt && cmpTime(m.createdAt, lastReadAt) > 0);
}

/**
 * Resync: the fresh newest page replaces the newest slice of the window (hard-deleted messages disappear). An older
 * kept message whose id the fresh page brings again is dropped too (defensive: one row per id, the fresh one wins).
 */
export function replaceNewest(list: readonly ChatMessage[], fresh: readonly ChatMessage[], freshHasMore: boolean): ChatMessage[] {
  const first = fresh[0];
  // The fresh page is the whole history when nothing older exists: it is the window.
  if (!first || !freshHasMore) return [...fresh];
  const freshIds = new Set(fresh.map((m) => m.id));
  return [...list.filter((m) => cmpMessages(m, first) < 0 && !freshIds.has(m.id)), ...fresh];
}

/** A signed URL lasts one hour; reuse it for 50 minutes at most so a long-open tab never shows a dead image. */
export const SIGNED_URL_REUSE_MS = 50 * 60 * 1000;

/** Keeps the signed URL already on screen for an unchanged attachment, so resync does not re-download images. */
export function keepSignedUrls(previous: readonly ChatMessage[], fresh: readonly ChatMessage[], now = Date.now()): ChatMessage[] {
  const reusable = new Map<string, MessageAttachment>();
  for (const m of previous) {
    for (const a of m.attachments) {
      if (a.url && a.signedAt !== undefined && now - a.signedAt < SIGNED_URL_REUSE_MS) reusable.set(a.id, a);
    }
  }
  return fresh.map((m) =>
    m.attachments.length === 0
      ? m
      : {
          ...m,
          attachments: m.attachments.map((a) => {
            const keep = reusable.get(a.id);
            return keep ? { ...a, url: keep.url, signedAt: keep.signedAt } : a;
          }),
        },
  );
}

/**
 * Reconciles a freshly read root message into the loaded window: replaced in place when present, inserted when it
 * belongs inside the window, ignored when it is older than what is loaded and more history exists, and ignored when
 * it is newer than what is loaded and `hasNewer` (an anchored view): appending it would leave a gap in the timeline.
 */
export function applyToWindow(list: readonly ChatMessage[], message: ChatMessage, hasMore: boolean, hasNewer = false): ChatMessage[] {
  if (list.some((m) => m.id === message.id)) return upsertSorted(list, message);
  if (hasMore && list.length > 0 && cmpMessages(message, list[0]!) < 0) return [...list];
  if (hasNewer && list.length > 0 && cmpMessages(message, list.at(-1)!) > 0) return [...list];
  return upsertSorted(list, message);
}
