// Optimistic sending: a message I sent is shown at once ("Enviando…") and replaced by the real one when the server
// confirms it. Pure helpers (no React, no Supabase).
import type { AttachmentInput } from "@/lib/chat/actions";
import { docToPlainText } from "@/lib/chat/content";
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
  /** Client key: the React key of the row, kept when the real message replaces it (no remount, no second animation). */
  key: string;
  doc: unknown;
  /** Plain text of `doc`, to recognise the message if it was written despite an error. */
  text: string;
  expanded: boolean;
  quotedId: string | null;
  quote: QuotePreview | null;
  attachments: PendingAttachment[];
  createdAt: string;
  /** Ids of my messages already on screen when I sent it: none of them can be this one. */
  seen: string[];
  status: "sending" | "failed";
  /**
   * Why it failed. `rejected`: the server refused it, nothing was written, resending is safe. `unknown`: the call
   * broke (network, timeout) and it may have been written: a retry first looks for it.
   */
  outcome?: "rejected" | "unknown";
  error?: string;
  /** The server id once it is known. */
  realId?: string;
}

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
    alphaAddress: null,
    expanded: p.expanded,
    quotedId: p.quotedId,
    quote: p.quote,
    replyCount: 0,
    lastReplyAt: null,
    pinnedAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: p.createdAt,
    attachments: p.attachments.map((a) => ({ id: a.id, url: a.previewUrl, mime: a.mime, width: a.width, height: a.height })),
    reactions: [],
    tips: [],
    tipId: null,
    tipLink: null,
  };
}

/**
 * The real message behind a pending one, if it was written: mine, in the channel (not a reply), the same text and
 * number of images, not on screen when it was sent and not already matched to another pending message.
 */
export function findLanded(p: PendingMessage, candidates: readonly ChatMessage[], meId: string, claimed: ReadonlySet<string>): ChatMessage | undefined {
  return candidates.find(
    (m) =>
      m.authorId === meId &&
      m.threadRootId === null &&
      m.deletedAt === null &&
      !p.seen.includes(m.id) &&
      !claimed.has(m.id) &&
      m.attachments.length === p.attachments.length &&
      docToPlainText(m.body) === p.text,
  );
}
