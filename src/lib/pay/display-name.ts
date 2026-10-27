export const DISPLAY_NAME_MAX = 40;

/** Bidi controls and zero-width characters: they can disguise a name (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069, U+FEFF). */
const INVISIBLE_RE = /[​-‏‪-‮⁦-⁩﻿]/;
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;

export type DisplayNameResult = { ok: true; name: string | null } | { ok: false };

/**
 * The display name of a public profile, as upsert_public_profile validates it (same rules in SQL): empty input means no
 * name; otherwise no bidi or zero-width character anywhere, a Unicode trim (String#trim), and 1..40 characters with no
 * control characters. Input that is only whitespace is rejected, not silently dropped.
 */
export function normalizeDisplayName(input: string): DisplayNameResult {
  if (input === "") return { ok: true, name: null };
  if (INVISIBLE_RE.test(input)) return { ok: false };
  const name = input.trim();
  if (name.length === 0 || [...name].length > DISPLAY_NAME_MAX || CONTROL_RE.test(name)) return { ok: false };
  return { ok: true, name };
}
