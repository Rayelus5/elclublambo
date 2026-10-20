// Unconfirmed optimistic sends of one channel, kept in sessionStorage so a remount of the chat (channel switch, a
// `?m=` jump) does not lose a failed message and its text. Per tab, best effort: storage may be unavailable.
import type { PendingMessage } from "@/lib/chat/pending";

const PREFIX = "ecl:chat-pending:";

type Stored = Omit<PendingMessage, "attachments" | "realId"> & {
  attachments: Array<Omit<PendingMessage["attachments"][number], "previewUrl">>;
};

/** Saves the messages not yet confirmed (a confirmed one, with its server id, is in the timeline already). */
export function savePending(channelId: string, list: readonly PendingMessage[]): void {
  try {
    const open: Stored[] = list
      .filter((p) => !p.realId)
      .map((p) => {
        const { realId, attachments, ...rest } = p;
        void realId;
        return { ...rest, attachments: attachments.map((a) => ({ id: a.id, mime: a.mime, width: a.width, height: a.height, uploaded: a.uploaded })) };
      });
    if (open.length === 0) sessionStorage.removeItem(PREFIX + channelId);
    else sessionStorage.setItem(PREFIX + channelId, JSON.stringify(open));
  } catch {
    // private mode, quota, no storage: the row simply does not survive a remount
  }
}

/**
 * The saved messages, all as failed: one that was still sending when the view went away has an unknown outcome
 * (a retry resends the same key and the server returns it if it was written). Local image previews do not survive.
 */
export function loadPending(channelId: string): PendingMessage[] {
  try {
    const raw = sessionStorage.getItem(PREFIX + channelId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Stored[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.key === "string" && typeof p.createdAt === "string")
      .map((p) => ({
        ...p,
        attachments: (p.attachments ?? []).map((a) => ({ ...a, previewUrl: "" })),
        status: "failed" as const,
        outcome: p.status === "failed" ? (p.outcome ?? "unknown") : "unknown",
        error: p.status === "failed" ? (p.error ?? "unknown") : "unknown",
      }));
  } catch {
    return [];
  }
}

/** Drops one message (confirmed after the view went away). */
export function forgetPending(channelId: string, key: string): void {
  savePending(
    channelId,
    loadPending(channelId).filter((p) => p.key !== key),
  );
}
