// How the message list is laid out: day separators, the unread separator and runs of the same author. Pure functions
// (no React): the time zone and "today" are inputs, so the server pass and tests are deterministic.
import { cmpMessages, cmpTime, isGrouped, type ChatMessage } from "@/lib/chat/model";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** `YYYY-MM-DD` of the instant in `timeZone`; null when the timestamp does not parse. */
export function dayKey(iso: string, timeZone: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  let fmt = dayFormats.get(timeZone);
  if (!fmt) {
    // en-CA formats as YYYY-MM-DD.
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormats.set(timeZone, fmt);
  }
  return fmt.format(ms);
}

function previousDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** «Hoy», «Ayer», «12 de octubre», or «12 de octubre de 2025» outside the current year (`today` null: always the year). */
export function dayLabel(key: string, today: string | null): string {
  if (today !== null) {
    if (key === today) return "Hoy";
    if (key === previousDay(today)) return "Ayer";
  }
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const base = `${d} de ${MONTHS[m - 1]}`;
  return today !== null && today.slice(0, 4) === key.slice(0, 4) ? base : `${base} de ${y}`;
}

export type TimelineEntry =
  | { type: "day"; key: string; label: string }
  | { type: "unread" }
  | { type: "message"; message: ChatMessage; grouped: boolean };

export interface TimelineOptions {
  /** `channel_reads.last_read_at` when the channel was opened. */
  lastReadAt: string | null;
  meId: string;
  /** The viewer's time zone; null on the server pass, which then draws no day separators. */
  timeZone: string | null;
  /** Today's `dayKey` in that zone (for «Hoy» / «Ayer»). */
  today: string | null;
}

/** The list in display order: a separator before each new day, «Nuevos» before the first unread, and the grouping. */
export function buildTimeline(messages: readonly ChatMessage[], { lastReadAt, meId, timeZone, today }: TimelineOptions): TimelineEntry[] {
  const unreadAt = lastReadAt ? messages.findIndex((m) => m.authorId !== meId && !m.deletedAt && cmpTime(m.createdAt, lastReadAt) > 0) : -1;
  const out: TimelineEntry[] = [];
  let lastDay: string | null = null;
  messages.forEach((m, i) => {
    let newDay = false;
    if (timeZone !== null) {
      const key = dayKey(m.createdAt, timeZone);
      if (key !== null && key !== lastDay) {
        out.push({ type: "day", key, label: dayLabel(key, today) });
        lastDay = key;
        newDay = true;
      }
    }
    if (i === unreadAt) out.push({ type: "unread" });
    out.push({ type: "message", message: m, grouped: !newDay && i !== unreadAt && isGrouped(messages[i - 1], m) });
  });
  return out;
}

/** A message that showed up after the list mounted (newer than its newest message then): it gets the entry animation. */
export function isArrival(message: ChatMessage, newestAtMount: ChatMessage | undefined): boolean {
  return newestAtMount === undefined || cmpMessages(message, newestAtMount) > 0;
}
