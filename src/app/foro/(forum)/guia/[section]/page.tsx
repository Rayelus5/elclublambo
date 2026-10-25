import Link from "next/link";
import { notFound } from "next/navigation";
import { GuideContent, isComingSoon } from "@/components/guide/guide-content";
import { GUIDE_SECTIONS, isGuideSlug } from "@/lib/guide/sections";

export function generateStaticParams() {
  return GUIDE_SECTIONS.map((s) => ({ section: s.slug }));
}

const linkClass =
  "inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export default async function GuideSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!isGuideSlug(section)) notFound();
  const i = GUIDE_SECTIONS.findIndex((s) => s.slug === section);
  const current = GUIDE_SECTIONS[i]!;
  const prev = GUIDE_SECTIONS[i - 1];
  const next = GUIDE_SECTIONS[i + 1];

  return (
    <article className="mx-auto flex w-full max-w-[68ch] flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link href="/guia" className={`${linkClass} self-start`}>
          Guía
        </Link>
        <h1 className="text-h1">{current.title}</h1>
        <p className="text-fg-muted">{current.summary}</p>
        {isComingSoon(current.slug) ? (
          <p role="note" className="rounded-control border border-warning px-3 py-2 text-sm text-warning">
            Disponible próximamente. Esta página explica cómo funcionará.
          </p>
        ) : null}
      </header>
      <GuideContent slug={current.slug} />
      <nav aria-label="Más secciones" className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
        {prev ? (
          <Link href={`/guia/${prev.slug}`} className={linkClass}>
            Anterior: {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/guia/${next.slug}`} className={linkClass}>
            Siguiente: {next.title}
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
