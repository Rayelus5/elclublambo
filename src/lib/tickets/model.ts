// Pure helpers for tickets (shared by the server actions and the client components): validation and the plain-text
// link splitter. Kept out of the "use server" module, which can only export async functions.

export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 120;
export const BODY_MAX = 4000;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Checked = { ok: true; value: string } | { ok: false };

/** Subject: trimmed, 3 to 120 characters (the database checks the same). */
export function validateSubject(raw: unknown): Checked {
  if (typeof raw !== "string") return { ok: false };
  const value = raw.trim();
  return value.length >= SUBJECT_MIN && value.length <= SUBJECT_MAX ? { ok: true, value } : { ok: false };
}

/** Message body: plain text, trimmed, 1 to 4000 characters. */
export function validateBody(raw: unknown): Checked {
  if (typeof raw !== "string") return { ok: false };
  const value = raw.trim();
  return value.length >= 1 && value.length <= BODY_MAX ? { ok: true, value } : { ok: false };
}

export type BodyPart = { type: "text"; value: string } | { type: "url"; value: string };

const URL_RE = /https?:\/\/[^\s<>"]+/gi;
const TRAILING = /[.,;:!?)\]}'»”]+$/;

/**
 * Splits plain text into text and http(s) url parts. Without `allowLinks` (the author lacked EMBED_LINKS when
 * writing) everything stays text. The url parts still go through the link guardian before they become anchors.
 */
export function linkifyPlainText(text: string, allowLinks: boolean): BodyPart[] {
  if (!allowLinks) return [{ type: "text", value: text }];
  const parts: BodyPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const url = m[0].replace(TRAILING, "");
    if (url.length <= "http://".length) continue;
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    parts.push({ type: "url", value: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}
