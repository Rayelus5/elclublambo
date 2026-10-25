// SECURITY: every /api/cron/* route handler must authenticate itself (bearer CRON_SECRET, constant-time compare); the
// proxy lets this prefix through without a session.
// The public part is served the same with or without a session, and the welcome gate skips it too: /start, the English
// tree (/en/*), the Spanish tools (/herramientas/*), ElClub Pay (/pay/*), /robots.txt and /sitemap.xml. "/" is not listed: the proxy resolves it (landing or
// forum) before the gate. The internal OG/Twitter images under /es/* are let through by the proxy (isInternalImagePath).
const PUBLIC_PREFIXES = [
  "/login",
  "/invite",
  "/no-access",
  "/banned",
  "/api/cron",
  "/start",
  "/en",
  "/herramientas",
  "/pay",
  "/robots.txt",
  "/sitemap.xml",
] as const;

/** Sanitizes a `?next=` value: only same-origin absolute paths, never auth pages. */
export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  // Control chars/whitespace (URL parsers strip TAB/CR/LF: "/\t/evil.com" -> "//evil.com") and backslashes.
  if (/[\x00-\x20\x7f\\]/.test(next)) return "/";
  const path = next.split(/[?#]/)[0] ?? next;
  if (path === "/login" || path.startsWith("/login/")) return "/";
  return next;
}

/** `/invite` alone is not public: only `/invite/*`. Other prefixes match exactly or with subpaths. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => {
    if (pathname.startsWith(`${p}/`)) return true;
    return p !== "/invite" && pathname === p;
  });
}
