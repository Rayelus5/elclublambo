import type { MetadataRoute } from "next";
import { isProductionSite, siteOrigin } from "@/lib/start/site";

// Production: only the public part is indexable (landing, /start, tools, ES and EN); the rest of the forum sits behind
// the login. /_next/ stays crawlable so a crawler can render the pages. Any other host (preproduction, local) is never indexed.
export default function robots(): MetadataRoute.Robots {
  if (!isProductionSite()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: ["/$", "/en", "/start", "/herramientas", "/_next/"], disallow: "/" },
    sitemap: `${siteOrigin().origin}/sitemap.xml`,
  };
}
