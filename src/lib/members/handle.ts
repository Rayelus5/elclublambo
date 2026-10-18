import fixture from "../../../tests/fixtures/handles.json";

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/** Shared with the SQL tests: one list, two implementations. */
export const RESERVED_HANDLES: readonly string[] = fixture.reserved;

export type HandleResult = { ok: true; handle: string } | { ok: false; error: "handle_invalid" | "handle_reserved" };

/** Trim + lowercase, then validate. Non-ASCII look-alikes (Cyrillic "а") fail the regex, so they are invalid. */
export function normalizeHandle(input: string): HandleResult {
  const handle = input.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) return { ok: false, error: "handle_invalid" };
  if (RESERVED_HANDLES.includes(handle)) return { ok: false, error: "handle_reserved" };
  return { ok: true, handle };
}
