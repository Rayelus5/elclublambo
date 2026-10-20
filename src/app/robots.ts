import type { MetadataRoute } from "next";
import { isProductionSite } from "@/lib/start/site";

// Production: only the public landing is indexable (the rest of the forum sits behind the login); /_next/ stays crawlable
// so a crawler can render /start. Any other host (preproduction, local) is never indexed.
export default function robots(): MetadataRoute.Robots {
  if (!isProductionSite()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: ["/start", "/_next/"], disallow: "/" },
  };
}
