// Optimistic sending: a message I sent is shown at once ("Enviando…") and replaced by the real one when the server
// confirms it. Its key is also the server's idempotency key (`messages.client_id`): a retry resends with the same key
// and the server returns the message it already wrote. Pure helpers (no React, no Supabase).
import type { AttachmentInput } from "@/lib/chat/actions";
import type { ChatMessage, QuotePreview } from "@/lib/chat/model";

export interface PendingAttachment {
  id: string;
  /** Local blob URL of the picked image (owned by the pending message until it is confirmed or discarded). */
  previewUrl: string;
  mime: string;
  width: number | null;
  height: number | null;
  uploaded: AttachmentInput;
}

export interface PendingMessage {
  /**
   * A uuid: the React key of the row (kept when the real message replaces it: no remount, no second animation) and the
   * `client_id` sent to the server, which deduplicates retries with it.
   */
  key: string;
  doc: unknown;
  expanded: boolean;
  quotedId: string | null;
  quote: QuotePreview | null;
  attachments: PendingAttachment[];
  createdAt: string;
  status: "sending" | "failed";
  /**
   * Why it failed. `rejected`: the server refused it, nothing was written. `unknown`: the call broke (network, timeout)
   * and it may have been written. Either way a retry is a plain resend with the same key.
   */
  outcome?: "rejected" | "unknown";
  error?: string;
  /** The server id once it is known. */
  realId?: string;
}

/** What the composer hands over when it sends optimistically. */
export type OutgoingMessage = Pick<PendingMessage, "doc" | "expanded" | "quotedId" | "attachments">;

export type SettleResult = { ok: true; id: string } | { ok: false; outcome: "rejected" | "unknown"; error: string };

/** Classifies the answer of postMessageAction (`null` when the call itself threw). */
export function settleOutcome(res: { id?: string; error?: string } | null): SettleResult {
  if (res?.id && !res.error) return { ok: true, id: res.id };
  const error = res?.error ?? "unknown";
  // A Postgres exception rolls the insert back: any code but "unknown" means nothing was written.
  return { ok: false, outcome: error === "unknown" ? "unknown" : "rejected", error };
}

/** The view model of a pending message: my own text message, with the local previews as its images. */
export function pendingToMessage(p: PendingMessage, meId: string, channelId: string): ChatMessage {
  return {
    id: p.key,
    channelId,
    threadRootId: null,
    authorId: meId,
    body: p.doc,
    allowLinks: true,
    kind: "text",
    alpha: null,
    expanded: p.expanded,
    quotedId: p.quotedId,
    quote: p.quote,
    replyCount: 0,
    lastReplyAt: null,
    pinnedAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: p.createdAt,
    clientId: p.key,
    // A restored message has lost its local previews: its images show as unavailable until it is sent.
    attachments: p.attachments.map((a) => ({ id: a.id, url: a.previewUrl || null, mime: a.mime, width: a.width, height: a.height })),
    reactions: [],
    tips: [],
    tipId: null,
    tipLink: null,
  };
}

/**
 * `m` is the real message behind the pending one: mine, carrying its key. Exact, never by text. A message the server
 * refused is never matched: nothing was written for it.
 */
export function isEchoOf(p: PendingMessage, m: ChatMessage, meId: string): boolean {
  return p.outcome !== "rejected" && m.authorId === meId && m.clientId === p.key;
}
