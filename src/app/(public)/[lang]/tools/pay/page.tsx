import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PayToolGate } from "@/components/pay/pay-tool-gate";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/i18n/routes";
import { isProductionSite } from "@/lib/start/site";

// Bloqueante a propósito (ver el layout de [lang]); la sesión se lee dentro de <Suspense>.
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[lang]/tools/pay">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = getDictionary(lang).pay.tool;
  const alternates = alternatesFor("payTool", undefined, lang);
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates,
    robots: isProductionSite() ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", url: alternates.canonical, siteName: "ElClub.", locale: OG_LOCALE[lang], title: t.metaTitle, description: t.metaDescription },
  };
}

export default async function PayToolPage({ params }: PageProps<"/[lang]/tools/pay">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = getDictionary(lang).pay.tool;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8 sm:py-12">
      <h1 className="font-display text-3xl font-bold text-fg">{t.title}</h1>
      <p className="text-base text-fg-muted">{t.lead}</p>
      <Suspense fallback={<div className="min-h-64" aria-hidden />}>
        <PayToolGate lang={lang} />
      </Suspense>
    </main>
  );
}
