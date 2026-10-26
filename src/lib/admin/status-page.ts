// Las páginas de estado con un 503 de verdad (A-R8). Next pone 200 a todo lo que pinta tras un rewrite del proxy
// (base-server reinicia statusCode antes de renderizar), así que el proxy pide la página a su propio origen y la devuelve
// él con 503. Lo usa el proxy: sin `server-only`.
import type { Lang } from "@/lib/i18n/config";
import { safeError } from "@/lib/security/redact";
import { isStatusPath } from "./paths";
import { siteStateTtlMs } from "./site-state";

export type StatusKind = "maintenance" | "unavailable";
export type StatusPage = { body: string; contentType: string };

/**
 * La cabecera con la que el proxy se pide a sí mismo /status/*. Sin ella, /status/* sigue siendo 404. Falsificarla solo
 * enseña la página de estado (el mismo HTML que cualquiera ve durante un mantenimiento): no abre nada.
 */
export const STATUS_FETCH_HEADER = "x-elclub-status";

const FETCH_TIMEOUT_MS = 2000;
const MAX_TTL_MS = 5000;

// `page: null` = un fallo reciente (caché negativa): se vuelve al rewrite sin pedir ni loguear otra vez.
const cache = new Map<string, { at: number; page: StatusPage | null }>();

export function __resetStatusPageCache(): void {
  cache.clear();
}

/** La petición interna del proxy a /status/* (solo GET/HEAD; pasa sin puerta, para no entrar en bucle). */
export function isInternalStatusRequest(pathname: string, method: string, headers: Headers): boolean {
  return (method === "GET" || method === "HEAD") && isStatusPath(pathname) && headers.get(STATUS_FETCH_HEADER) === "1";
}

const LOOPBACK = new Set(["0.0.0.0", "127.0.0.1", "localhost", "[::]", "[::1]"]);

/**
 * Adónde se pide el proxy a sí mismo:
 * - `INTERNAL_ORIGIN`, si es una URL http(s) válida;
 * - si la petición llega a una dirección de escucha o de loopback (PRE detrás del túnel: Next construye
 *   `https://0.0.0.0:3000` porque cloudflared manda `X-Forwarded-Proto: https`, pero escucha en http), siempre
 *   `http://127.0.0.1:<puerto>`;
 * - si no (Vercel), el origen de la petición.
 */
export function statusFetchOrigin(nextUrl: URL, env: Record<string, string | undefined> = process.env): string {
  const configured = env.INTERNAL_ORIGIN?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      // Inválida: se ignora.
    }
  }
  if (LOOPBACK.has(nextUrl.hostname)) return `http://127.0.0.1:${nextUrl.port || env.PORT || 3000}`;
  return nextUrl.origin;
}

type Input = {
  origin: string;
  lang: Lang;
  kind: StatusKind;
  acceptLanguage: string | null;
  fetcher?: typeof fetch;
  now?: number;
};

/**
 * El HTML de /status/{lang}/{kind}, pedido al propio origen. Se guarda en memoria hasta 5 s por idioma y tipo (la CSP es
 * estática, sin nonce, así que el HTML no depende de la petición); con SITE_STATE_TTL_MS=0 (e2e) no se guarda. Cualquier
 * fallo (red, tiempo, no 2xx) devuelve null, deja un log con el código y se recuerda el mismo tiempo (un log por ventana).
 */
export async function fetchStatusPage({ origin, lang, kind, acceptLanguage, fetcher = fetch, now = Date.now() }: Input): Promise<StatusPage | null> {
  const ttl = Math.min(siteStateTtlMs(), MAX_TTL_MS);
  const key = `${lang}:${kind}`;
  const hit = cache.get(key);
  if (ttl > 0 && hit && now - hit.at < ttl) return hit.page;
  try {
    const headers: Record<string, string> = { [STATUS_FETCH_HEADER]: "1" };
    if (acceptLanguage) headers["accept-language"] = acceptLanguage;
    const res = await fetcher(new URL(`/status/${lang}/${kind}`, origin), {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`status page ${res.status}`);
    const page = { body: await res.text(), contentType: res.headers.get("content-type") ?? "text/html; charset=utf-8" };
    if (ttl > 0) cache.set(key, { at: now, page });
    else cache.delete(key);
    return page;
  } catch (e) {
    console.error("[status-page] fetch failed", safeError(e));
    if (ttl > 0) cache.set(key, { at: now, page: null });
    return null;
  }
}
