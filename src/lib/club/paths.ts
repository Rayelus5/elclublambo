/**
 * The club (forum, gate pages, welcome) lives under /foro; the root belongs to the public part (R1). Every club link
 * and redirect goes through clubPath, never a hand-written "/foro/..." string.
 */
export const CLUB_BASE = "/foro";

/** The pre-R1 root URLs of the login and welcome pages: still recognised (they 308 to the club) so a stale ?next= cannot loop. */
export const LEGACY_LOGIN_PATH = "/login";
export const LEGACY_WELCOME_PATH = "/bienvenida";

/** True when `path` (with or without query/hash) already starts with the club base as a whole segment. */
function hasBase(path: string): boolean {
  if (!path.startsWith(CLUB_BASE)) return false;
  const next = path.charAt(CLUB_BASE.length);
  return next === "" || next === "/" || next === "?" || next === "#";
}

/**
 * The club URL for an in-club path: `"/"` → `"/foro"`, `"/c/x?m=1"` → `"/foro/c/x?m=1"`. Query and hash are kept.
 * Idempotent: a path that already starts with /foro is returned as it is.
 */
export function clubPath(path: string = "/"): string {
  if (hasBase(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  // "/" itself, or "/?x" / "/#x": the club home without a trailing slash.
  if (p === "/" || p.startsWith("/?") || p.startsWith("/#")) return CLUB_BASE + p.slice(1);
  return CLUB_BASE + p;
}

/** The in-club part of a pathname (`"/foro/c/x"` → `"/c/x"`, `"/foro"` → `"/"`), or null outside the club. */
export function clubRelative(pathname: string): string | null {
  if (pathname === CLUB_BASE) return "/";
  if (!pathname.startsWith(`${CLUB_BASE}/`)) return null;
  return pathname.slice(CLUB_BASE.length) || "/";
}
