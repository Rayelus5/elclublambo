"use client";

import Link from "next/link";
import { m } from "motion/react";
import { ArrowRight } from "lucide-react";
import { rise, Stage } from "@/components/start/motion";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";

/**
 * P6-R6: one short row after the vouches teaser that names approvals, multisend and gas in a single line and links
 * to the hub. A smaller heading than VouchTeaser so two big rows don't stack; outline link, no brand fill
 * («Crear sorteo» keeps it).
 */
export function MoreToolsTeaser({ lang, t }: { lang: Lang; t: Dictionary["landing"] }) {
  return (
    <section aria-labelledby="landing-more-tools" className="border-t border-border">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-12 sm:px-8 sm:py-14 lg:flex-row lg:items-center lg:justify-between">
        <Stage className="flex flex-col gap-3">
          <m.h2
            variants={rise}
            id="landing-more-tools"
            className="text-[clamp(1.5rem,3vw,2.25rem)] leading-[1] font-black tracking-[-0.03em] text-fg"
          >
            {t.moreTools.title}
          </m.h2>
          <m.p variants={rise} className="max-w-[36rem] text-[1.0625rem] text-fg-muted">
            {t.moreTools.lead}
          </m.p>
        </Stage>
        <div className="shrink-0">
          <Link
            href={localizedPath(lang, "tools")}
            className="group inline-flex min-h-12 items-center gap-3 border border-accent px-6 py-3 font-bold text-fg no-underline transition-colors duration-150 hover:bg-surface rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {t.moreTools.cta}
            <ArrowRight aria-hidden className="size-5 text-accent transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={2.25} />
          </Link>
        </div>
      </div>
    </section>
  );
}
