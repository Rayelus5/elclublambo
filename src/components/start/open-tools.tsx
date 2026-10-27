"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { m } from "motion/react";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import type { StartDict } from "./dict";
import { rise, Stage } from "./motion";

/** Cross link landing <-> club: whoever has no invitation yet can still use the open tools. */
export function OpenTools({ t, lang }: { t: StartDict; lang: Lang }) {
  return (
    <section aria-labelledby="start-herramientas" className="border-t border-border">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-16 sm:px-8 sm:py-24">
        <Stage className="flex max-w-[44rem] flex-col gap-5">
          <m.h2 variants={rise} id="start-herramientas" className="text-[clamp(1.75rem,4vw,3.25rem)] leading-[0.95] font-black tracking-[-0.03em]">
            {t.openTools.title}
          </m.h2>
          <m.p variants={rise} className="max-w-[36rem] text-fg-muted">
            {t.openTools.lead}
          </m.p>
          <m.div variants={rise}>
            <Link
              href={localizedPath(lang, "tools")}
              className="inline-flex min-h-12 items-center gap-3 border border-accent px-5 py-3 font-bold text-fg no-underline outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent rounded-control"
            >
              {t.openTools.cta}
              <ArrowRight aria-hidden className="size-4 text-accent" strokeWidth={2} />
            </Link>
          </m.div>
        </Stage>
      </div>
    </section>
  );
}
