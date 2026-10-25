import type { MetadataRoute } from "next";
import { alternatesFor, type RouteKey } from "@/lib/i18n/routes";
import { isProductionSite, siteOrigin } from "@/lib/start/site";

const ROUTES: RouteKey[] = ["home", "start", "tools", "giveaways", "payTool", "checker", "checkerApi", "vouches", "donate"];

// Solo producción se indexa; el detalle de cada sorteo es noindex y no figura aquí. Español como URL principal, inglés como alternativa.
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isProductionSite()) return [];
  const origin = siteOrigin().origin;
  return ROUTES.map((route) => {
    const { languages } = alternatesFor(route, undefined, "es");
    return {
      url: origin + languages.es,
      alternates: { languages: { es: origin + languages.es, en: origin + languages.en } },
    };
  });
}
