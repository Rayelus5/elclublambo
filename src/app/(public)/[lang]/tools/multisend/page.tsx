import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { MultisendLazy } from "@/components/multisend/multisend-lazy";
import { getPublicSession } from "@/lib/auth/public-session";
import { appChainIds } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE, type Lang } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/i18n/routes";
import { isProductionSite } from "@/lib/start/site";

// Bloqueante a propósito (ver el layout de [lang]). La sesión se lee dentro de <Suspense>, después de connection(),
// nunca en el build; la lista (#envio=) vive en el fragmento y solo la lee el navegador.
export const instant = false;

type Props = PageProps<"/[lang]/tools/multisend">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = getDictionary(lang).multisend;
  const alternates = alternatesFor("multisend", undefined, lang);
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates,
    robots: isProductionSite() ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", url: alternates.canonical, siteName: "ElClub.", locale: OG_LOCALE[lang], title: t.metaTitle, description: t.metaDescription },
  };
}

/** The session's wallet (only it may sign when there is a session; Review Focus 2), read per request. */
async function MultisendContent({ lang }: { lang: Lang }) {
  await connection();
  const session = await getPublicSession();
  return <MultisendLazy lang={lang} chains={appChainIds()} sessionWallet={session?.wallet ?? null} />;
}

export default async function MultisendPage({ params }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = getDictionary(lang).multisend;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold text-fg">{t.title}</h1>
        <p className="text-base text-fg-muted">{t.lead}</p>
      </div>
      <Suspense
        fallback={
          <div role="status" aria-live="polite" className="min-h-96">
            <span className="sr-only">{t.loading}</span>
            <div aria-hidden className="h-96 rounded-panel bg-surface-2 motion-safe:animate-pulse" />
          </div>
        }
      >
        <MultisendContent lang={lang} />
      </Suspense>
    </main>
  );
}
