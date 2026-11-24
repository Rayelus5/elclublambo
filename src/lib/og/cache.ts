// A share card is the heaviest request of the site (a full image render) and every link preview and crawler fetches it.
// Next answers a request-time one with `max-age=0`, so without these the CDN kept none of them. (Turbopack does not
// prerender metadata image routes under [lang], not even with generateStaticParams, so the CDN is the cache.)

/**
 * A card drawn from the URL alone (the landing, /start, a pay link): the CDN keeps it a week. It only changes with a
 * deployment, and a new deployment starts with an empty cache.
 */
export const OG_URL_CACHE = "public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400";

/** A card that reads live data (a giveaway's title and state): an hour, then served stale while it renders again. */
export const OG_LIVE_CACHE = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";
