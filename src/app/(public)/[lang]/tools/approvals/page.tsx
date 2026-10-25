import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/i18n/routes";
import { isProductionSite } from "@/lib/start/site";

// Marcador de P6: la ruta existe (mapa, sitemap y proxy) y la herramienta llega en la Task 3 del plan.
export const instant = false;

type Props = PageProps<"/[lang]/tools/approvals">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = getDictionary(lang).approvals;
  const alternates = alternatesFor("approvals", undefined, lang);
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates,
    robots: isProductionSite() ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", url: alternates.canonical, siteName: "ElClub.", locale: OG_LOCALE[lang], title: t.metaTitle, description: t.metaDescription },
  };
}

export default async function ApprovalsPage({ params }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const dict = getDictionary(lang);
  const t = dict.approvals;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold text-fg">{t.metaTitle}</h1>
        <p className="text-base text-fg-muted">{t.metaDescription}</p>
      </div>
      <p className="rounded-control border border-border p-3 text-sm text-fg-muted">{dict.tools.comingSoon}</p>
    </main>
  );
}
