const PUBLIC_PREFIXES = ["/login", "/invite", "/no-access", "/banned"] as const;

/** `/invite` alone is not public: only `/invite/*`. Other prefixes match exactly or with subpaths. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => {
    if (pathname.startsWith(`${p}/`)) return true;
    return p !== "/invite" && pathname === p;
  });
}
