"use client";

import Link from "next/link";
import { m } from "motion/react";
import { ArrowRight } from "lucide-react";
import { rise, Stage } from "@/components/start/motion";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";

/** Vouches (P5-R10): one short row after the checker, an outline link to the tool. No brand fill: «Crear sorteo» keeps it. */
export function VouchTeaser({ lang, t }: { lang: Lang; t: Dictionary["landing"] }) {
  return (
    <section aria-labelledby="landing-vouches" className="border-t border-border">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-4 py-16 sm:px-8 sm:py-20 lg:flex-row lg:items-end lg:justify-between">
        <Stage className="flex flex-col gap-4">
          <m.h2
            variants={rise}
            id="landing-vouches"
            className="text-[clamp(2rem,4.5vw,3.75rem)] leading-[0.95] font-black tracking-[-0.04em] text-fg"
          >
            {t.vouches.title}
          </m.h2>
          <m.p variants={rise} className="max-w-[32rem] text-[1.0625rem] text-fg-muted">
            {t.vouches.lead}
          </m.p>
        </Stage>
        <div className="shrink-0">
          <Link
            href={localizedPath(lang, "vouches")}
            className="group inline-flex min-h-12 items-center gap-3 border border-accent px-6 py-3 font-bold text-fg no-underline transition-colors duration-150 hover:bg-surface rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {t.vouches.cta}
            <ArrowRight aria-hidden className="size-5 text-accent transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={2.25} />
          </Link>
        </div>
      </div>
    </section>
  );
}
