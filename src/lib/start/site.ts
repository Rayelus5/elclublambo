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
