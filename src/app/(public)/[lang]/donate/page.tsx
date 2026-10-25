import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NetworkLogo } from "@/components/economy/network-logo";
import { DonateGate, settle } from "@/components/public-donations/donate-gate";
import { PageLoader } from "@/components/shell/page-loader";
import { getCachedPublicDonationOverview, getCachedSafeBalances } from "@/lib/donations/public-cached";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE, type Lang } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/i18n/routes";
import { isProductionSite } from "@/lib/start/site";
import { formatToken, formatUsdIn } from "@/lib/treasury/format";

// Bloqueante a propósito (ver el layout de [lang]); la sesión y las lecturas en vivo van dentro de <Suspense>.
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[lang]/donate">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = getDictionary(lang).donate;
  const alternates = alternatesFor("donate", undefined, lang);
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates,
    robots: isProductionSite() ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", url: alternates.canonical, siteName: "ElClub.", locale: OG_LOCALE[lang], title: t.metaTitle, description: t.metaDescription },
  };
}

/** formatToken prints Spanish separators; English swaps them. */
function tokenIn(units: bigint, token: "USDC" | "ETH", lang: Lang): string {
  const s = formatToken(units, token);
  return lang === "en" ? s.replace(/[.,]/g, (c) => (c === "." ? "," : ".")) : s;
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="font-display text-xl font-bold text-fg">
          {title}
        </h2>
        {intro ? <p className="text-[13px] text-fg-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Public totals only: no names and no addresses (P3-R8: the club's donor list stays in the club). */
async function Overview({ lang }: { lang: Lang }) {
  const t = getDictionary(lang).donate;
  const overview = await settle("overview", getCachedPublicDonationOverview());
  if (!overview) return <p className="text-sm text-danger">{t.readFailed}</p>;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-[13px] text-fg-muted">{t.totalDonated}</dt>
          <dd className="font-display text-2xl font-bold break-words text-fg tabular-nums sm:text-3xl">{formatUsdIn(BigInt(overview.totalUsd6), lang)}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-[13px] text-fg-muted">{t.donationCount}</dt>
          <dd className="font-display text-2xl font-bold text-fg tabular-nums sm:text-3xl">{overview.donationCount}</dd>
        </div>
      </dl>
      <p className="text-[13px] text-fg-muted">{t.usdNote}</p>
    </div>
  );
}

/** What the Safe holds on each network, read on-chain (cached for a minute: public page, see public-cached.ts). */
async function SafeBalancesBlock({ lang }: { lang: Lang }) {
  const t = getDictionary(lang).donate;
  const balances = await settle("safe balances", getCachedSafeBalances());
  if (!balances) return <p className="text-sm text-danger">{t.readFailed}</p>;
  const amount = (v: string | null, token: "USDC" | "ETH") =>
    v === null ? <span className="text-fg-muted">{t.notAvailable}</span> : <span className="font-mono text-fg tabular-nums">{tokenIn(BigInt(v), token, lang)}</span>;
  return (
    <ul aria-label={t.safeTitle} className="flex flex-col divide-y divide-border">
      {balances.map((b) => (
        <li key={b.chainId} className="flex min-h-11 flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <NetworkLogo chainId={b.chainId} withName className="text-sm" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {amount(b.usdc, "USDC")}
            {amount(b.eth, "ETH")}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function DonatePage({ params }: PageProps<"/[lang]/donate">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = getDictionary(lang).donate;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:py-12">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold text-fg">{t.title}</h1>
        <p className="max-w-2xl text-base text-fg-muted">{t.lead}</p>
        <ul className="flex max-w-2xl list-disc flex-col gap-2 pl-5 text-base text-fg-muted">
          <li>{t.explain1}</li>
          <li>{t.explain2}</li>
          <li>{t.explain3}</li>
        </ul>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section id="donate-overview" title={t.overviewTitle}>
            <Suspense fallback={<div className="min-h-24" aria-hidden />}>
              <Overview lang={lang} />
            </Suspense>
          </Section>
          <Section id="donate-safe" title={t.safeTitle} intro={t.safeIntro}>
            <Suspense fallback={<PageLoader label={t.safeLoading} className="min-h-24" />}>
              <SafeBalancesBlock lang={lang} />
            </Suspense>
          </Section>
        </div>
        <Section id="donate-panel" title={t.panelTitle}>
          <Suspense fallback={<div className="min-h-64" aria-hidden />}>
            <DonateGate lang={lang} />
          </Suspense>
        </Section>
      </div>
    </main>
  );
}
