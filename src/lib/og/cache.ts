import { LANGS } from "@/lib/i18n/config";

// A share card is the heaviest request of the site (a full image render) and every link preview and crawler fetches it.
// Next answers a request-time one with `max-age=0`, so without these the CDN kept none of them.

/** A card drawn from the URL alone (pay link): the CDN keeps it a week; a new deployment starts with an empty cache. */
export const OG_URL_CACHE = "public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400";

/** A card that reads live data (a giveaway's title and state): an hour, then served stale while it renders again. */
export const OG_LIVE_CACHE = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";

/** The cards that only depend on the language: both are built at build time (re-exported as generateStaticParams). */
export function ogLangParams(): { lang: string }[] {
  return LANGS.map((lang) => ({ lang }));
}
