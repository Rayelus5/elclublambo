import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MyGiveaways } from "@/components/public-giveaways/my-giveaways";
import { PublicConnectLazy } from "@/components/public/public-connect-lazy";
import { getPublicSession } from "@/lib/auth/public-session";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE, type Lang } from "@/lib/i18n/config";
import { alternatesFor, localizedPath } from "@/lib/i18n/routes";
import { isProductionSite } from "@/lib/start/site";

// Bloqueante a propósito (ver el layout de [lang]); la sesión se lee dentro de <Suspense>.
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[lang]/tools/giveaways">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = getDictionary(lang).giveaways.home;
  const alternates = alternatesFor("giveaways", undefined, lang);
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates,
    robots: isProductionSite() ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", url: alternates.canonical, siteName: "ElClub.", locale: OG_LOCALE[lang], title: t.metaTitle, description: t.metaDescription },
  };
}

/** Listing or connect hint, decided by the session. */
async function Mine({ lang }: { lang: Lang }) {
  if (await getPublicSession()) return <MyGiveaways lang={lang} />;
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-small text-fg-muted">{getDictionary(lang).giveaways.home.connectHint}</p>
      <PublicConnectLazy lang={lang} next={localizedPath(lang, "giveaways")} />
    </div>
  );
}

export default async function GiveawaysToolPage({ params }: PageProps<"/[lang]/tools/giveaways">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const { giveaways, common } = getDictionary(lang);
  const t = giveaways.home;
  const steps = [
    [t.step1Title, t.step1Text],
    [t.step2Title, t.step2Text],
    [t.step3Title, t.step3Text],
  ];
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:py-12">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold text-fg">{t.title}</h1>
        <p className="max-w-prose text-base text-fg-muted">{t.lead}</p>
      </header>
      <section aria-label={t.stepsLabel}>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map(([title, text], i) => (
            <li key={title} className="flex flex-col gap-2 rounded-control border border-border-strong bg-surface p-5">
              <span aria-hidden className="font-mono text-small font-bold text-accent">
                {i + 1}
              </span>
              <h2 className="font-display text-lg font-bold text-fg">{title}</h2>
              <p className="text-base text-fg-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>
      <div>
        <Link
          href={localizedPath(lang, "giveawayNew")}
          className="inline-flex min-h-11 items-center rounded-control bg-accent-fill px-5 font-bold text-accent-fill-fg outline-none transition-colors duration-150 hover:bg-accent-fill-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {t.create}
        </Link>
      </div>
      <Suspense fallback={<div className="min-h-24" aria-hidden />}>
        <Mine lang={lang} />
      </Suspense>
      <p className="text-small text-fg-muted">{common.noCustody}</p>
    </main>
  );
}
