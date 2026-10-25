/** The production origin: /start's canonical always points here (preproduction serves a duplicate). */
export const CANONICAL_ORIGIN = "https://www.elclub.party";

/** Base for the absolute OG/Twitter image URLs: the host that serves this build (falls back to production). */
export function siteOrigin(env: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): URL {
  try {
    if (env) return new URL(env);
  } catch {
    // Malformed: fall through to production.
  }
  return new URL(CANONICAL_ORIGIN);
}

const PRODUCTION_HOSTS = new Set(["www.elclub.party", "elclub.party"]);

/** Whether this build serves production (its NEXT_PUBLIC_SITE_URL host). Anything else (preproduction, local) is never indexed. */
export function isProductionSite(env: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): boolean {
  if (!env) return false;
  try {
    return PRODUCTION_HOSTS.has(new URL(env).hostname);
  } catch {
    return false;
  }
}

/**
 * The origin server-side absolute redirects are built on. The standalone Docker server (preproduction) binds
 * HOSTNAME=0.0.0.0:3000 behind the Cloudflare Tunnel, so the request URL is the bind address, never the public host:
 * the site URL wins when it is a valid http(s) URL; otherwise (local dev, E2E) the request's own origin.
 */
export function publicOrigin(
  request: { nextUrl: URL },
  env: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string {
  if (env) {
    try {
      const url = new URL(env);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // Malformed: fall through to the request origin.
    }
  }
  return request.nextUrl.origin;
}
