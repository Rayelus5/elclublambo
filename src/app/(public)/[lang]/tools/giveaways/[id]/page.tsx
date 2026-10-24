import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GiveawayDetail } from "@/components/public-giveaways/giveaway-detail";
import { getPublicSession } from "@/lib/auth/public-session";
import { getDictionary } from "@/lib/i18n";
import { isLang } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/i18n/routes";
import { maybeDrawOnView } from "@/lib/public-giveaways/draw-on-view";
import { getPublicGiveaway, isPublicGiveawayId } from "@/lib/public-giveaways/queries";

// Bloqueante a propósito (ver el layout de [lang]): un id desconocido responde 404 de verdad. Sesión y datos se leen
// dentro de <Suspense> (cacheComponents).
export const instant = false;

type Props = PageProps<"/[lang]/tools/giveaways/[id]">;

/** P2-R8: each giveaway is noindex; the title is the giveaway's own. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, id } = await params;
  if (!isLang(lang) || !isPublicGiveawayId(id)) return {};
  let title = getDictionary(lang).giveaways.detail.metaTitle;
  try {
    const g = await getPublicGiveaway(id, null);
    if (g) title = g.title;
  } catch {
    // The page itself reports the failure; the metadata keeps the generic title.
  }
  return { title, robots: { index: false, follow: false }, alternates: alternatesFor("giveaway", { id }, lang) };
}

async function Content({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { lang, id } = await params;
  if (!isLang(lang) || !isPublicGiveawayId(id)) notFound();
  const session = await getPublicSession();
  let view = await getPublicGiveaway(id, session?.userId ?? null);
  if (!view) notFound();
  // P2-R11: a due giveaway whose round exists is closed and drawn on the visit; then read it again in this same render.
  if (await maybeDrawOnView(view)) view = (await getPublicGiveaway(id, session?.userId ?? null)) ?? view;
  const { join } = await searchParams;
  return (
    <GiveawayDetail
      lang={lang}
      view={view}
      signedIn={session !== null}
      viewerWallet={session?.wallet ?? null}
      autoFocusJoin={session !== null && join === "1"}
    />
  );
}

export default function PublicGiveawayPage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:py-12">
      <Suspense fallback={<div className="min-h-96" aria-hidden />}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
