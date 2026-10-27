import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreateForm } from "@/components/public-giveaways/create-form";
import { PublicConnectLazy } from "@/components/public/public-connect-lazy";
import { getPublicSession } from "@/lib/auth/public-session";
import { chainsForSet, networkSet } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import { isLang, type Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";

// Bloqueante a propósito (ver el layout de [lang]); la sesión se lee dentro de <Suspense>.
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[lang]/tools/giveaways/new">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  return { title: getDictionary(lang).giveaways.create.pageTitle, robots: { index: false, follow: false } };
}

/** Session gate: the connect explainer without a session, the form with one. */
async function Gate({ lang }: { lang: Lang }) {
  const { giveaways, common } = getDictionary(lang);
  if (!(await getPublicSession())) {
    const t = giveaways.create;
    return (
      <div className="flex flex-col gap-5">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-base text-fg-muted">
          <li>{t.explain1}</li>
          <li>{t.explain2}</li>
          <li>{t.explain3}</li>
        </ul>
        <p className="text-sm text-fg-muted">{t.connectHint}</p>
        <div>
          <PublicConnectLazy lang={lang} next={localizedPath(lang, "giveawayNew")} />
        </div>
        <p className="text-sm text-fg-muted">{common.noCustody}</p>
      </div>
    );
  }
  return <CreateForm lang={lang} t={giveaways.create} errors={giveaways.errors} chains={chainsForSet(networkSet())} />;
}

export default async function NewGiveawayPage({ params }: PageProps<"/[lang]/tools/giveaways/new">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = getDictionary(lang).giveaways.create;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8 sm:py-12">
      <h1 className="font-display text-2xl font-bold text-fg">{t.pageTitle}</h1>
      <Suspense fallback={<div className="min-h-64" aria-hidden />}>
        <Gate lang={lang} />
      </Suspense>
    </main>
  );
}
