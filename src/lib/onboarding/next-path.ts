import { safeNextPath as safeAuthNextPath } from "@/lib/auth/public-paths";

/**
 * Where to send the member once the welcome is done. Same-origin single-slash paths only (no `//`, `/\`, control
 * characters, absolute URLs) and never the welcome itself, so it cannot loop. Anything else is `/`.
 */
export function safeNextPath(raw: string | null): string {
  const path = safeAuthNextPath(raw);
  const base = path.split(/[?#]/)[0] ?? path;
  if (base === "/bienvenida" || base.startsWith("/bienvenida/")) return "/";
  return path;
}
