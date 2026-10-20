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
