import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckerContent } from "@/components/checker/checker-content";
import { firstParam } from "@/lib/checker/input";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/i18n/routes";
import { isProductionSite } from "@/lib/start/site";

// Bloqueante a propósito (ver el layout de [lang]). La consulta (?q=) se lee dentro de <Suspense>; el límite por IP y
// los análisis corren después de connection(), nunca en el build.
export const instant = false;

type Props = PageProps<"/[lang]/tools/checker">;

/** The empty page is indexable in production; a report (?q=) never is. */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = getDictionary(lang).checker;
  const alternates = alternatesFor("checker", undefined, lang);
  const hasQuery = firstParam((await searchParams).q).trim() !== "";
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates,
    robots: !hasQuery && isProductionSite() ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", url: alternates.canonical, siteName: "ElClub.", locale: OG_LOCALE[lang], title: t.metaTitle, description: t.metaDescription },
  };
}

export default async function CheckerPage({ params, searchParams }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = getDictionary(lang).checker;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold text-fg">{t.title}</h1>
        <p className="text-base text-fg-muted">{t.lead}</p>
      </div>
      <Suspense
        fallback={
          <div role="status" aria-live="polite" className="flex min-h-64 flex-col gap-4">
            <span className="sr-only">{t.loading}</span>
            <div aria-hidden className="h-11 rounded-control bg-surface-2 motion-safe:animate-pulse" />
            <div aria-hidden className="h-48 rounded-panel bg-surface-2 motion-safe:animate-pulse" />
          </div>
        }
      >
        <CheckerContent lang={lang} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
