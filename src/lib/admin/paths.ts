// Rutas que le importan a la administración: qué herramienta es una URL, qué deja pasar el mantenimiento y en qué idioma
// se muestran las páginas de estado. Puro (lo usa el proxy).
import type { Lang } from "@/lib/i18n/config";
import { isInternalImagePath } from "@/lib/i18n/public-routing";
import { toInternalPath } from "@/lib/i18n/routes";
import type { ToolKey } from "./state";

const FLAT_TOOLS: Record<string, ToolKey> = { pay: "pay", vouches: "vouches", approvals: "approvals", multisend: "multisend", gas: "gas" };

// Las imágenes OG/Twitter llevan un hash en la URL pública (`opengraph-image-1a2b`); se clasifican como su página.
const IMAGE_TAIL = /\/(?:opengraph|twitter)-image(?:-[a-z0-9]+)?$/;

const hasPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");

/** A-R9. `null` si la URL no pertenece a ningún interruptor. */
export function toolForPath(pathname: string): ToolKey | null {
  if (hasPrefix(pathname, "/api/v1/check")) return "checkerApi";
  const parsed = toInternalPath(pathname.replace(IMAGE_TAIL, "") || "/", false);
  if (!parsed) {
    // El recibo de ElClub Pay se valida contra las cadenas del entorno; aquí basta con el prefijo.
    const segs = pathname.split("/").filter(Boolean);
    return (segs[0] === "en" ? segs[1] : segs[0]) === "pay" ? "pay" : null;
  }
  const [, first, second, third] = parsed.internal.split("/").filter(Boolean);
  if (first === "donate") return "donate";
  if (first === "pay") return "pay";
  if (first !== "tools" || second === undefined) return null;
  if (second === "giveaways") return "giveaways";
  if (second === "checker") return third === "api" ? "checkerApi" : "checker";
  return FLAT_TOOLS[second] ?? null;
}

/** A-R7, por límites de segmento (`/api/cronx` no pasa). */
export function isMaintenanceBypass(pathname: string): boolean {
  return (
    hasPrefix(pathname, "/api/cron") ||
    hasPrefix(pathname, "/api/webhooks") ||
    pathname === "/api/team-access" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    isInternalImagePath(pathname)
  );
}

export function isStatusPath(pathname: string): boolean {
  return hasPrefix(pathname, "/status");
}

/** A-R12. */
export function statusLang(pathname: string, acceptLanguage: string | null): Lang {
  const first = pathname.split("/").filter(Boolean)[0];
  if (first === "en") return "en";
  if (pathname === "/" || pathname === "/donar") return "es";
  if (toInternalPath(pathname, false)?.lang === "es") return "es";
  const tag = (acceptLanguage ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return tag.startsWith("en") ? "en" : "es";
}
