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

/**
 * The message as it is kept: line breaks normalised, control and invisible characters gone, spaces joined, at most one
 * blank line in a row, trimmed. Null when nothing is left or it is longer than `max` characters.
 */
export function cleanBody(raw: string, max: number): string | null {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\n' ? c : ''))
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const length = [...text].length;
  return length === 0 || length > max ? null : text;
}
