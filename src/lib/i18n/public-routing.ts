import { toInternalPath, toPublicPath } from "./routes";
import { isLang } from "./config";

export type PublicState = "anon" | "public" | "member";
export type PublicDecision =
  | { kind: "rewrite"; to: string }
  | { kind: "redirect"; to: string }
  | { kind: "pass" };

const PASS: PublicDecision = { kind: "pass" };
// Next añade un hash al nombre de la imagen en la URL de la metadata (`opengraph-image-1a2b3c`).
const IMAGE_SEGMENT = /^(?:opengraph|twitter)-image(?:-[a-z0-9]+)?$/;

/**
 * Las imágenes OG/Twitter bajo el árbol interno (`/es/...`, `/en/...`): Next emite esas URLs en la metadata, así que se
 * sirven tal cual, a cualquier profundidad (R-B).
 */
export function isInternalImagePath(pathname: string): boolean {
  const segs = pathname.split("/").filter(Boolean);
  const first = segs[0];
  const last = segs[segs.length - 1];
  return segs.length >= 2 && first !== undefined && isLang(first) && last !== undefined && IMAGE_SEGMENT.test(last);
}

/**
 * Segmentos estáticos de primer nivel de la app: carpetas de `src/app` (grupos de rutas aplanados; `[lang]` no cuenta),
 * los ficheros de metadata de la raíz y los ficheros de `public/` que el matcher del proxy no excluye. Un test los compara
 * con el árbol real.
 */
export const APP_TOP_SEGMENTS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "banned",
  "bienvenida",
  "c",
  "dao",
  "donar",
  "favicon.ico",
  "guia",
  "invite",
  "invites",
  "login",
  "mercado",
  "moderation",
  "no-access",
  "notifications",
  "out",
  "perfil",
  "robots.txt",
  "settings",
  "sitemap.xml",
  "sorteos",
  "tickets",
  "u",
]);

/**
 * Un único segmento que no es un idioma, ni una ruta de la app, ni una URL pública española (`/start`, `/herramientas`):
 * Next lo resolvería con `[lang]` y el `notFound()` del layout respondería 200 en streaming, así que el proxy decide el 404.
 */
export function isUnknownTopSegment(pathname: string): boolean {
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length !== 1) return false;
  const seg = segs[0]!;
  return !isLang(seg) && !APP_TOP_SEGMENTS.has(seg) && toInternalPath(pathname) === null;
}

/**
 * Decide qué hace el proxy con la parte pública bilingüe (pura, para test):
 * - `/` es la landing salvo para un miembro (ve el foro);
 * - las URLs españolas del mapa se reescriben al árbol interno `/es/...`;
 * - una visita directa a `/es/...` redirige (308) a su URL canónica;
 * - lo demás (inglés, foro, desconocidas) pasa.
 */
export function decidePublicRoute(pathname: string, state: PublicState): PublicDecision {
  if (pathname === "/") return state === "member" ? PASS : { kind: "rewrite", to: "/es" };
  if (isInternalImagePath(pathname)) return PASS;

  const first = pathname.split("/").filter(Boolean)[0];
  if (first === "es") {
    const canonical = toPublicPath(pathname);
    return canonical ? { kind: "redirect", to: canonical } : PASS;
  }

  const parsed = toInternalPath(pathname);
  if (parsed && parsed.lang === "es") return { kind: "rewrite", to: parsed.internal };
  return PASS;
}
