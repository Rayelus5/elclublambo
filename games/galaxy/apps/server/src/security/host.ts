import type { FastifyInstance } from 'fastify';

// The game's own domain (galaxysurvivor.es plan, PR 1; GDD §18.1). Two redirects, decided before anything else runs:
// - `www.` + the canonical host always goes to the canonical origin (301 for GET and HEAD, 308 for the rest, which
//   keeps the method and the body);
// - an old host (the cutover switch) moves only its page loads: GET or HEAD of /galaxy or /galaxy/…, outside the API and
//   the assets, of a web route (no file extension: the fonts and the favicon stay), from a navigation (Sec-Fetch-Dest
//   absent or `document`). Open tabs keep loading their chunks, fonts and workers and keep their API and sockets on the
//   old host, and Stripe's old webhook URL keeps working.
// Redirects are private (never kept by Cloudflare's edge, which caches a 301 on a static extension by its URL alone) and
// cached for a day, so going back (switch off) does not stick in browsers. The target is always built on the canonical
// origin and checked to stay there: a request path can never send a player to another host.

/** Cache-Control of every redirect: browsers only (never the edge), for a day, so a rollback reaches them soon. */
export const REDIRECT_CACHE = 'private, max-age=86400';
/** Where a request path that would leave the canonical origin lands instead: the game. */
const FALLBACK_PATH = '/galaxy/';
const SAFE_METHODS = new Set(['GET', 'HEAD']);

export interface HostRedirectConfig {
  /** The game's own origin (`https://galaxysurvivor.es`), or null: no redirect at all. */
  canonicalOrigin: string | null;
  /** Old hosts (lowercase, no port) whose page loads move to the canonical origin. Empty: the switch is off. */
  legacyHosts: string[];
}

/** What the decision needs from a request: the raw request target (path and query, as sent) and two headers. */
export interface RedirectRequest {
  method: string;
  host: string | undefined;
  url: string;
  secFetchDest: string | undefined;
}

export interface Redirect {
  status: 301 | 308;
  location: string;
}

/** The host's name: lowercase, without its port or a final dot (`[::1]:8080` keeps its brackets). */
function hostnameOf(host: string | undefined): string {
  let h = (host ?? '').trim().toLowerCase();
  const end = h.startsWith('[') ? h.indexOf(']') + 1 : h.indexOf(':');
  if (end > 0) h = h.slice(0, end);
  return h.endsWith('.') ? h.slice(0, -1) : h;
}

/** A file of the web (`favicon.svg`, `fonts/x.woff2`), not a route: its last segment has an extension. */
function isFile(path: string): boolean {
  return /\.[^/.]+$/.test(path.slice(path.lastIndexOf('/') + 1));
}

/** Exactly `prefix`, or anything under `prefix/`. */
function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + '/');
}

/** The same path and query on the canonical origin; one that would resolve anywhere else gets the game instead. */
function onCanonical(canonical: string, rawUrl: string): string {
  if (rawUrl.startsWith('/')) {
    try {
      const target = new URL(rawUrl, canonical);
      if (target.origin === canonical) return target.href;
    } catch {
      // Not a URL: the fallback below.
    }
  }
  return canonical + FALLBACK_PATH;
}

/**
 * Where this request must go instead, or null to serve it here. Pure: the hook and the tests share it.
 */
export function redirectTarget(req: RedirectRequest, cfg: HostRedirectConfig): Redirect | null {
  const canonical = cfg.canonicalOrigin;
  if (!canonical) return null;
  const host = hostnameOf(req.host);
  const canonicalHost = new URL(canonical).hostname;
  if (!host || host === canonicalHost) return null;
  const safe = SAFE_METHODS.has(req.method);
  if (host === `www.${canonicalHost}`) return { status: safe ? 301 : 308, location: onCanonical(canonical, req.url) };
  if (!safe || !cfg.legacyHosts.includes(host)) return null;
  if (req.secFetchDest !== undefined && req.secFetchDest !== 'document') return null;
  const path = req.url.split('?')[0] ?? '';
  if (!under(path, '/galaxy') || under(path, '/galaxy/api') || under(path, '/galaxy/assets') || isFile(path)) return null;
  return { status: 301, location: onCanonical(canonical, req.url) };
}

/**
 * The redirects as a root `onRequest` hook. Register it right after @fastify/websocket (whose own hook marks an upgrade,
 * so its socket is destroyed after our reply) and before everything else (static files, the CSRF guard, the API), so it
 * runs for every request, unknown paths included. Without a canonical origin it is not registered at all.
 */
export function registerHostRedirects(app: FastifyInstance, cfg: HostRedirectConfig): void {
  if (!cfg.canonicalOrigin) return;
  app.addHook('onRequest', async (req, reply) => {
    const dest = req.headers['sec-fetch-dest'];
    const target = redirectTarget({ method: req.method, host: req.headers.host, url: req.url, secFetchDest: typeof dest === 'string' ? dest : undefined }, cfg);
    if (!target) return;
    reply.code(target.status).header('location', target.location).header('cache-control', REDIRECT_CACHE);
    // A WebSocket upgrade never becomes a socket here: the client is told the connection ends with this reply.
    if (req.headers.upgrade) reply.header('connection', 'close');
    return reply.send();
  });
}
