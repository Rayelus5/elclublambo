// SECURITY: every /api/cron/* route handler must authenticate itself (bearer CRON_SECRET, constant-time compare); the
// proxy lets this prefix through without a session.
// /start is the public landing (with its generated OG/Twitter images under /start/*) and /robots.txt lets crawlers in:
// both are served the same with or without a session, and the welcome gate skips them too.
const PUBLIC_PREFIXES = ["/login", "/invite", "/no-access", "/banned", "/api/cron", "/start", "/robots.txt"] as const;

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
