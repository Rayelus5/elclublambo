import { cmpTime, type ChatMessage } from "@/lib/chat/model";

/** Within this many pixels of the end the list counts as "at the bottom" and keeps following new messages. */
export const BOTTOM_SLACK = 48;

/** Centres a message in its scroller. Instant under `prefers-reduced-motion`, smooth otherwise. */
export function scrollMessageIntoView(el: Element, instant = false): void {
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView?.({ block: "center", behavior: reduce || instant ? "auto" : "smooth" });
}

export function isNearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, slack = BOTTOM_SLACK): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < slack;
}

export type ScrollAction = "anchor" | "bottom" | "keep" | "none";

/**
 * What the list does after it re-renders: the first placement goes to the `?m=` anchor (or the bottom); my own send
 * forces the bottom; a prepended page keeps the reading position; anything else follows only a reader at the bottom.
 */
export function decideScroll(s: { initial: boolean; anchorFound: boolean; forced: boolean; prepended: boolean; atBottom: boolean }): ScrollAction {
  if (s.initial) return s.anchorFound ? "anchor" : "bottom";
  if (s.forced) return "bottom";
  if (s.prepended) return "keep";
  return s.atBottom ? "bottom" : "none";
}

export interface Cursor {
  createdAt: string;
  id: string;
}

/** Messages of other members (not deleted) newer than `mark`: what the reader missed while scrolled up. */
export function countUnseen(messages: readonly ChatMessage[], mark: Cursor | null, meId: string): number {
  if (!mark) return 0;
  return messages.filter(
    (m) => m.authorId !== meId && !m.deletedAt && (cmpTime(m.createdAt, mark.createdAt) || (m.id < mark.id ? -1 : m.id > mark.id ? 1 : 0)) > 0,
  ).length;
}

export function newMessagesLabel(n: number): string {
  return n === 1 ? "1 mensaje nuevo" : `${n} mensajes nuevos`;
}
