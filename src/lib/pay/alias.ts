import fixture from "../../../tests/fixtures/public-aliases.json";

export const ALIAS_RE = /^[a-z0-9_]{3,20}$/;

/** Shared with the SQL tests: one list, two implementations (the club handles plus the route words, P3-R3). */
export const RESERVED_ALIASES: readonly string[] = fixture.reserved;

export type AliasResult = { ok: true; alias: string } | { ok: false; error: "alias_invalid" | "alias_reserved" };

/** Trim + lowercase, then validate. Non-ASCII look-alikes (Cyrillic "а") fail the regex, so they are invalid. */
export function normalizeAlias(input: string): AliasResult {
  const alias = input.trim().toLowerCase();
  if (!ALIAS_RE.test(alias)) return { ok: false, error: "alias_invalid" };
  if (RESERVED_ALIASES.includes(alias)) return { ok: false, error: "alias_reserved" };
  return { ok: true, alias };
}
