// Client-side mirror of public._search_tsquery (supabase/migrations/20261017400002_search_fixes.sql):
// the query is trimmed and cut to 100 chars, unaccented and lowercased, split into runs of letters/digits,
// terms shorter than 2 chars are dropped BEFORE the 8-term cap, and every term matches as a prefix.
// Keep both in sync: if the SQL tokenization changes, so must this file.

export const MAX_QUERY_CHARS = 100;
export const MAX_TERMS = 8;
export const MIN_TERM_CHARS = 2;

export type Segment = { text: string; match: boolean };

/** unaccent + lower, in the same order as the SQL (`lower(f_unaccent(x))`). Marks left by lower() are dropped too. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

const WORD = /[\p{L}\p{N}]+/gu;

export function searchTerms(q: string): string[] {
  const cut = Array.from(q.trim()).slice(0, MAX_QUERY_CHARS).join("");
  const terms: string[] = [];
  for (const m of fold(cut).matchAll(WORD)) {
    if (m[0].length < MIN_TERM_CHARS) continue;
    terms.push(m[0]);
    if (terms.length === MAX_TERMS) break;
  }
  return terms;
}

/**
 * Splits `text` into segments, marking the words that start with one of the query terms (accent and case
 * insensitive). Pure text in, text out: the caller renders the segments as React text nodes.
 */
export function highlight(text: string, q: string): Segment[] {
  if (text === "") return [];
  const terms = searchTerms(q);
  if (terms.length === 0) return [{ text, match: false }];

  // Fold per original code point so folded offsets map back to the original text.
  const chars = Array.from(text);
  let folded = "";
  const origin: number[] = []; // folded index -> index into `chars`
  chars.forEach((ch, i) => {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) origin.push(i);
    folded += f;
  });

  const marked = new Array<boolean>(chars.length).fill(false);
  for (const m of folded.matchAll(WORD)) {
    const start = m.index;
    // the longest matching term, so "li linea" marks all of "linea"
    const term = terms.filter((t) => m[0].startsWith(t)).sort((a, b) => b.length - a.length)[0];
    if (term === undefined) continue;
    const first = origin[start]!;
    let last = origin[start + term.length - 1]!;
    // include combining marks that trail the last matched letter ("cafe" + U+0301)
    while (last + 1 < chars.length && /^\p{M}+$/u.test(chars[last + 1]!)) last++;
    for (let i = first; i <= last; i++) marked[i] = true;
  }

  const out: Segment[] = [];
  chars.forEach((ch, i) => {
    const prev = out[out.length - 1];
    if (prev && prev.match === marked[i]) prev.text += ch;
    else out.push({ text: ch, match: marked[i]! });
  });
  return out;
}
