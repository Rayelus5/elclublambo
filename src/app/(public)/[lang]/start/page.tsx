import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StartLanding } from "@/components/start/start-landing";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/i18n/routes";
import { isProductionSite, siteOrigin } from "@/lib/start/site";

// Public, and indexable only in production (the rest of the forum never is). The OG/Twitter images come from opengraph-image.tsx.
export async function generateMetadata({ params }: PageProps<"/[lang]/start">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = getDictionary(lang).start;
  const alternates = alternatesFor("start", undefined, lang);
  return {
    metadataBase: siteOrigin(),
    title: { absolute: t.metaTitle },
    description: t.metaDescription,
    alternates,
    robots: isProductionSite() ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: "website",
      url: alternates.canonical,
      siteName: "ElClub.",
      locale: OG_LOCALE[lang],
      title: t.metaTitle,
      description: t.metaDescription,
    },
    twitter: { card: "summary_large_image", title: t.metaTitle, description: t.metaDescription },
  };
}

// Bloqueante a propósito (ver el layout de [lang]).
export const instant = false;

export default async function StartPage({ params }: PageProps<"/[lang]/start">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return <StartLanding lang={lang} t={getDictionary(lang).start} />;
}
