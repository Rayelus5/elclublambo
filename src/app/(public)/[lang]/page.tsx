import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { IntroGate } from "@/components/landing/intro-gate";
import { LandingLive } from "@/components/landing/landing-live";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/i18n/routes";
import { isProductionSite, siteOrigin } from "@/lib/start/site";

// Bloqueante a propósito (ver el layout): el idioma se lee antes de pintar. Sin sesión; los interruptores (A-R16) se
// leen por petición dentro de <Suspense>, después de connection().
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = getDictionary(lang).landing;
  const alternates = alternatesFor("home", undefined, lang);
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

export default async function PublicHome({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <>
      <IntroGate lang={lang} />
      <Suspense fallback={<main id="main" tabIndex={-1} className="flex-1 outline-none" aria-busy="true" />}>
        <LandingLive lang={lang} />
      </Suspense>
    </>
  );
}
