import { clubPath, LEGACY_LOGIN_PATH } from "@/lib/club/paths";

// SECURITY: every /api/cron/* route handler must authenticate itself (bearer CRON_SECRET, constant-time compare); the
// proxy lets this prefix through without a session.
// /api/v1/* is the public checker API (token and link reports, optionally x402-paid): it reads no session and exposes no
// member data, and each handler rate-limits by hashed IP. Every other /api/* route stays gated (matching is boundary-aware:
// "/api/v1x" is not public).
// The club's gate pages (login, invite, no-access, banned) live under /foro (R1).
// The public part is served the same with or without a session, and the welcome gate skips it too: /start, the English
// tree (/en/*), the Spanish tools (/herramientas/*), ElClub Pay (/pay/*), /robots.txt and /sitemap.xml. "/" and "/donar"
// are not listed: the proxy rewrites them to the public tree before the gate. The internal OG/Twitter images under /es/*
// are let through by the proxy (isInternalImagePath).
const CLUB_INVITE = clubPath("/invite");
const PUBLIC_PREFIXES = [
  clubPath("/login"),
  CLUB_INVITE,
  clubPath("/no-access"),
  clubPath("/banned"),
  "/api/cron",
  "/api/v1",
  "/start",
  "/en",
  "/herramientas",
  "/pay",
  "/robots.txt",
  "/sitemap.xml",
] as const;

const LOGIN_PAGES = [clubPath("/login"), LEGACY_LOGIN_PATH];

/**
 * Sanitizes a `?next=` value: only same-origin absolute paths, never the login pages (the club's, or the old root one
 * that redirects to it). Anything else is `fallback`: the club home by default (R1-R4); the public connect passes "/".
 */
export function safeNextPath(next: string | null, fallback: string = clubPath()): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Control chars/whitespace (URL parsers strip TAB/CR/LF: "/\t/evil.com" -> "//evil.com") and backslashes.
  if (/[\x00-\x20\x7f\\]/.test(next)) return fallback;
  const path = next.split(/[?#]/)[0] ?? next;
  if (LOGIN_PAGES.some((p) => path === p || path.startsWith(`${p}/`))) return fallback;
  return next;
}

/** Club-mode `next`: like `safeNextPath`, but an exact "/" (the landing) lands on the club home. */
export function safeClubNextPath(next: string | null): string {
  return next === "/" ? clubPath() : safeNextPath(next);
}

/** `/foro/invite` alone is not public: only `/foro/invite/*`. Other prefixes match exactly or with subpaths. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => {
    if (pathname.startsWith(`${p}/`)) return true;
    return p !== CLUB_INVITE && pathname === p;
  });
}
