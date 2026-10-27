import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VouchNotice } from "@/components/vouches/vouch-notice";
import { VouchesContent } from "@/components/vouches/vouches-content";
import { firstParam } from "@/lib/checker/input";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/i18n/routes";
import { isProductionSite } from "@/lib/start/site";

// Bloqueante a propósito (ver el layout de [lang]). La consulta (?address=), la sesión, la BD y la RPC se leen dentro
// de <Suspense>, después de connection(), nunca en el build.
export const instant = false;

type Props = PageProps<"/[lang]/tools/vouches">;

/** The empty page is indexable in production; a lookup (?address=) never is. */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = getDictionary(lang).vouches;
  const alternates = alternatesFor("vouches", undefined, lang);
  const hasAddress = firstParam((await searchParams).address).trim() !== "";
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates,
    robots: !hasAddress && isProductionSite() ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", url: alternates.canonical, siteName: "ElClub.", locale: OG_LOCALE[lang], title: t.metaTitle, description: t.metaDescription },
  };
}

export default async function VouchesPage({ params, searchParams }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = getDictionary(lang).vouches;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold text-fg">{t.title}</h1>
        <p className="text-base text-fg-muted">{t.lead}</p>
      </div>
      <VouchNotice text={t.notice} />
      <Suspense
        fallback={
          <div role="status" aria-live="polite" className="flex min-h-64 flex-col gap-4">
            <span className="sr-only">{t.loading}</span>
            <div aria-hidden className="h-11 rounded-control bg-surface-2 motion-safe:animate-pulse" />
            <div aria-hidden className="h-48 rounded-panel bg-surface-2 motion-safe:animate-pulse" />
          </div>
        }
      >
        <VouchesContent lang={lang} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
