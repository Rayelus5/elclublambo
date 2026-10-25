import { safeClubNextPath as safeAuthNextPath } from "@/lib/auth/public-paths";
import { clubPath, LEGACY_WELCOME_PATH } from "@/lib/club/paths";

const WELCOME = clubPath("/bienvenida");

/**
 * Where to send the member once the welcome is done. Same-origin single-slash paths only (no `//`, `/\`, control
 * characters, absolute URLs) and never the welcome itself (nor its old root URL), so it cannot loop. Anything else is
 * the club home (`/foro`, R1-R4).
 */
export function safeNextPath(raw: string | null): string {
  const path = safeAuthNextPath(raw);
  const base = path.split(/[?#]/)[0] ?? path;
  if ([WELCOME, LEGACY_WELCOME_PATH].some((p) => base === p || base.startsWith(`${p}/`))) return clubPath();
  return path;
}
