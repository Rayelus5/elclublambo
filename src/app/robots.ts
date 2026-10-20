import type { MetadataRoute } from "next";

// Only the public landing is indexable: the rest of the forum sits behind the login. /_next/ stays crawlable so a
// crawler can render /start (its CSS, fonts and scripts).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/start", "/_next/"], disallow: "/" },
  };
}
