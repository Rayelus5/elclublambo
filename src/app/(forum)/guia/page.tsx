import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { GUIDE_SECTIONS } from "@/lib/guide/sections";

export const metadata = { title: "Guía" };

export default function GuidePage() {
  return (
    <div className="flex max-w-[68ch] flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Guía</h1>
        <p className="text-fg-muted">
          Cómo se mueve el dinero en El Club, explicado sin prisa. El club nunca custodia tus fondos: todo se hace con
          transferencias normales desde tu wallet.
        </p>
      </header>
      <ul className="flex flex-col gap-3">
        {GUIDE_SECTIONS.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/guia/${s.slug}`}
              className="flex min-h-11 items-center justify-between gap-4 rounded-panel border border-border bg-surface p-4 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <span className="flex flex-col gap-1">
                <span className="font-display text-lg font-bold text-fg">{s.title}</span>
                <span className="text-sm text-fg-muted">{s.summary}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-fg-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
