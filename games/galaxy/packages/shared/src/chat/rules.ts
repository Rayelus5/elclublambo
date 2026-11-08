import type { ConfigValue } from '../config/registry';

// The chats (GDD §14.4; M5b-2): what a message keeps of what was typed, and the live word filter. Nothing here is
// ever drawn as HTML (the web escapes text); this only keeps messages clean and readable.

export type ChatConfig = ConfigValue<'chat'>;

/** Lower case without accents: the filter does not care how a word is written. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Covers every whole word of the filter with asterisks (same length), whatever its case or its accents. */
export function maskWords(body: string, words: readonly string[]): string {
  if (words.length === 0) return body;
  const banned = new Set(words.map(fold));
  return body.replace(/[\p{L}\p{N}]+/gu, (word) => (banned.has(fold(word)) ? '*'.repeat([...word].length) : word));
}

// Format characters that join emoji and some scripts stay: ZWNJ and ZWJ (Persian, Indic, 🧑‍🚀) and the tag characters
// of flags like 🏴󠁧󠁢󠁥󠁮󠁧󠁿. The rest (direction controls, zero-width spaces, the BOM) only hide or reorder text.
const keepFormat = (c: string) => c === '\u200C' || c === '\u200D' || (c.codePointAt(0)! >= 0xe0020 && c.codePointAt(0)! <= 0xe007f);

/**
 * The message as it is kept: composed (NFC), line breaks normalised, control and invisible characters gone, spaces
 * joined, at most one blank line in a row, at most four marks on a letter (no towers of accents over other messages),
 * trimmed. Null when nothing is left or it is longer than `max` characters.
 */
export function cleanBody(raw: string, max: number): string | null {
  const text = raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\p{Cf}/gu, (c) => (keepFormat(c) ? c : ''))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\p{Cc}/gu, (c) => (c === '\n' ? c : ''))
    .replace(/(\p{M}{4})\p{M}+/gu, '$1')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const length = [...text].length;
  return length === 0 || length > max ? null : text;
}
