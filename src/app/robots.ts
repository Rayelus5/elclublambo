import type { MetadataRoute } from "next";
import { isProductionSite, siteOrigin } from "@/lib/start/site";

// Production: only the public part is indexable (landing, /start, tools, ES and EN); the rest of the forum sits behind
// the login. /_next/ stays crawlable so a crawler can render the pages. The Spanish pages point their OG/Twitter images at
// the internal /es tree (the only /es URLs served as they are). "/en$" + "/en/" so /english is not allowed. Any other
// host (preproduction, local) is never indexed.
export default function robots(): MetadataRoute.Robots {
  if (!isProductionSite()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: ["/$", "/en$", "/en/", "/start", "/herramientas", "/es/*opengraph-image", "/es/*twitter-image", "/_next/"], disallow: "/" },
    sitemap: `${siteOrigin().origin}/sitemap.xml`,
  };
}
