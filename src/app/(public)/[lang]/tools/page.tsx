import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, Gift, ScanSearch, Wallet } from "lucide-react";
import { ToolCard } from "@/components/public/tool-card";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE } from "@/lib/i18n/config";
import { alternatesFor, localizedPath } from "@/lib/i18n/routes";
import { isProductionSite } from "@/lib/start/site";

// Bloqueante a propósito (ver el layout): el idioma se lee antes de pintar.
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[lang]/tools">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = getDictionary(lang).tools;
  const alternates = alternatesFor("tools", undefined, lang);
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates,
    robots: isProductionSite() ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", url: alternates.canonical, siteName: "ElClub.", locale: OG_LOCALE[lang], title: t.metaTitle, description: t.metaDescription },
  };
}

export default async function ToolsPage({ params }: PageProps<"/[lang]/tools">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = getDictionary(lang).tools;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold text-fg">{t.title}</h1>
        <p className="max-w-prose text-base text-fg-muted">{t.lead}</p>
      </header>
      <ul aria-label={t.listLabel} className="grid gap-4 sm:grid-cols-2">
        <ToolCard icon={Gift} name={t.giveaways.name} text={t.giveaways.text} status={t.available} href={localizedPath(lang, "giveaways")} />
        <ToolCard icon={Wallet} name={t.pay.name} text={t.pay.text} status={t.available} href={localizedPath(lang, "payTool")} />
        <ToolCard icon={ScanSearch} name={t.checker.name} text={t.checker.text} status={t.available} href={localizedPath(lang, "checker")} />
        <ToolCard icon={BadgeCheck} name={t.guarantees.name} text={t.guarantees.text} status={t.comingSoon} />
      </ul>
    </main>
  );
}
