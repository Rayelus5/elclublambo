import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmbedSnippet } from "@/components/pay/embed-snippet";
import { LinkBuilder } from "@/components/pay/link-builder";
import { ProfileForm } from "@/components/pay/profile-form";
import { PublicConnectLazy } from "@/components/public/public-connect-lazy";
import { getPublicSession } from "@/lib/auth/public-session";
import { assetsFor } from "@/lib/economy/assets";
import { chainsForSet, networkSet } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE, type Lang } from "@/lib/i18n/config";
import { alternatesFor, localizedPath } from "@/lib/i18n/routes";
import { getMyPublicProfile } from "@/lib/pay/queries";
import { isProductionSite, siteOrigin } from "@/lib/start/site";

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

const SECTION = "flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6";

/** Session gate: the three-line explainer and the connect button without a session; profile, link and button with one. */
async function Gate({ lang }: { lang: Lang }) {
  const t = getDictionary(lang).pay.tool;
  const session = await getPublicSession();
  if (!session) {
    return (
      <div className="flex flex-col gap-5">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-base text-fg-muted">
          <li>{t.explain1}</li>
          <li>{t.explain2}</li>
          <li>{t.explain3}</li>
        </ul>
        <p className="text-sm text-fg-muted">{t.connectHint}</p>
        <div>
          <PublicConnectLazy lang={lang} next={localizedPath(lang, "payTool")} />
        </div>
        <p className="text-sm text-fg-muted">{t.noCustody}</p>
      </div>
    );
  }
  const profile = await getMyPublicProfile();
  const origin = siteOrigin().origin;
  const assetIds = profile ? assetsFor(chainsForSet(networkSet()), profile.acceptNetworks).map((a) => a.id) : [];
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="pay-profile" className={SECTION}>
        <h2 id="pay-profile" className="font-display text-xl font-bold text-fg">
          {t.profileTitle}
        </h2>
        <ProfileForm lang={lang} t={t} initial={profile} isMember={session.isMember} />
      </section>
      {profile ? (
        <>
          <section aria-labelledby="pay-link-title" className={SECTION}>
            <h2 id="pay-link-title" className="font-display text-xl font-bold text-fg">
              {t.linkTitle}
            </h2>
            <p className="text-sm text-fg-muted">{t.linkLead}</p>
            <LinkBuilder lang={lang} t={t} alias={profile.alias} origin={origin} assetIds={assetIds} />
          </section>
          <section aria-labelledby="pay-embed-title" className={SECTION}>
            <h2 id="pay-embed-title" className="font-display text-xl font-bold text-fg">
              {t.embedTitle}
            </h2>
            <p className="text-sm text-fg-muted">{t.embedLead}</p>
            <EmbedSnippet lang={lang} t={t} alias={profile.alias} origin={origin} />
          </section>
        </>
      ) : null}
      <p className="text-sm text-fg-muted">{t.noCustody}</p>
    </div>
  );
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
        <Gate lang={lang} />
      </Suspense>
    </main>
  );
}
