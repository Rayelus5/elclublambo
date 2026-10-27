import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Info } from "lucide-react";
import { GasContent } from "@/components/gas/gas-content";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/i18n/routes";
import { isProductionSite } from "@/lib/start/site";

// Bloqueante a propósito (ver el layout de [lang]). Las lecturas de RPC (gas de cada red, oráculo de L1, precio de ETH)
// van dentro de <Suspense>, después de connection(), nunca en el build.
export const instant = false;

type Props = PageProps<"/[lang]/tools/gas">;

/** Indexable in production: the page has no query. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = getDictionary(lang).gas;
  const alternates = alternatesFor("gas", undefined, lang);
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates,
    robots: isProductionSite() ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", url: alternates.canonical, siteName: "ElClub.", locale: OG_LOCALE[lang], title: t.metaTitle, description: t.metaDescription },
  };
}

export default async function GasPage({ params }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const dict = getDictionary(lang);
  const t = dict.gas;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold text-fg">{t.title}</h1>
        <p className="text-base text-fg-muted">{t.lead}</p>
      </div>
      <div className="flex flex-col gap-2 rounded-control border border-border p-3 text-sm text-fg-muted">
        <p className="flex items-start gap-2">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t.notice}
        </p>
        <p className="pl-6">{dict.common.noCustody}</p>
      </div>
      <Suspense
        fallback={
          <div role="status" aria-live="polite" className="flex min-h-64 flex-col gap-4">
            <span className="sr-only">{t.loading}</span>
            <div aria-hidden className="h-64 rounded-panel bg-surface-2 motion-safe:animate-pulse" />
            <div aria-hidden className="h-64 rounded-panel bg-surface-2 motion-safe:animate-pulse" />
          </div>
        }
      >
        <GasContent lang={lang} />
      </Suspense>
    </main>
  );
}
