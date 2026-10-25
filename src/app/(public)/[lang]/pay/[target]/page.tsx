import { Suspense } from "react";
import type { Metadata } from "next";
import { PayPageContent } from "@/components/pay/pay-page-content";
import { payTitleName } from "@/lib/pay/target";
import { getDictionary } from "@/lib/i18n";
import { isLang, OG_LOCALE } from "@/lib/i18n/config";
import { fill } from "@/lib/i18n/fill";
import { alternatesFor } from "@/lib/i18n/routes";

// Bloqueante a propósito (ver el layout de [lang]). El perfil y la query se leen dentro de <Suspense> (cacheComponents),
// así que el 404 de un alias inexistente lo decide el proxy; el notFound() de PayPageContent es la red de seguridad.
export const instant = false;

type Props = PageProps<"/[lang]/pay/[target]">;

/** P3-R11: noindex. The title names the alias or the shortened address without reading the database. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, target } = await params;
  if (!isLang(lang)) return {};
  const t = getDictionary(lang).pay.page;
  const name = payTitleName(target);
  const title = name ? fill(t.metaTitleTo, { name }) : t.metaTitle;
  const alternates = alternatesFor("pay", { target }, lang);
  return {
    title,
    description: t.metaDescription,
    alternates,
    robots: { index: false, follow: false },
    openGraph: { type: "website", url: alternates.canonical, siteName: "ElClub.", locale: OG_LOCALE[lang], title, description: t.metaDescription },
  };
}

export default function PayPage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-8 sm:py-12">
      <Suspense fallback={<div className="min-h-96" aria-hidden />}>
        <PayPageContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
