"use client";

import Link from "next/link";
import { m } from "motion/react";
import { ArrowRight } from "lucide-react";
import { rise, Stage } from "@/components/start/motion";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";

const focus = "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/** The one primary action of the page: create a giveaway. */
export function CreateLink({ lang, label }: { lang: Lang; label: string }) {
  return (
    <Link
      href={localizedPath(lang, "giveawayNew")}
      className={`group inline-flex min-h-12 items-center gap-3 bg-accent px-6 py-3 font-bold text-accent-foreground no-underline transition-opacity duration-150 hover:opacity-90 rounded-control ${focus}`}
    >
      {label}
      <ArrowRight aria-hidden className="size-5 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={2.25} />
    </Link>
  );
}

/** Secondary: what the club is (/start). */
export function WhatIsLink({ lang, label }: { lang: Lang; label: string }) {
  return (
    <Link
      href={localizedPath(lang, "start")}
      className={`inline-flex min-h-12 items-center border border-border-strong px-6 py-3 font-bold text-fg no-underline transition-colors duration-150 hover:border-fg rounded-control ${focus}`}
    >
      {label}
    </Link>
  );
}

/** The «Próximamente» stamp. */
export function SoonBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center border border-accent px-2 py-0.5 font-mono text-[0.75rem] leading-5 font-normal tracking-wide whitespace-nowrap text-accent uppercase rounded-control">
      {label}
    </span>
  );
}

/** An action that is not live yet: focusable (never a trap), announced as disabled, does nothing (P2-R10). */
export function SoonButton({ label, soon }: { label: string; soon: string }) {
  return (
    <button
      type="button"
      aria-disabled="true"
      className={`inline-flex min-h-12 cursor-not-allowed flex-wrap items-center gap-3 border border-border-strong bg-surface px-5 py-3 text-left font-bold text-fg-muted rounded-control ${focus}`}
    >
      {label}
      <SoonBadge label={soon} />
    </button>
  );
}

export function FinalCta({ lang, t }: { lang: Lang; t: Dictionary["landing"] }) {
  return (
    <section aria-labelledby="landing-final" className="relative overflow-hidden border-t border-border">
      <div className="relative mx-auto flex w-full max-w-[1600px] flex-col px-4 py-24 sm:px-8 sm:py-36">
        {/* The accent rail of the demo, coming to rest beside the last call to action. */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-4 w-px bg-accent sm:left-8" />
        <Stage className="flex max-w-[64rem] flex-col gap-8 pl-6 sm:pl-10">
          <m.h2
            variants={rise}
            id="landing-final"
            className="text-[clamp(2.5rem,8vw,7rem)] leading-[0.9] font-black tracking-[-0.045em] text-fg"
          >
            {t.final.title}
          </m.h2>
          <m.p variants={rise} className="max-w-[36rem] text-[1.125rem] text-fg-muted">
            {t.final.lead}
          </m.p>
          <m.div variants={rise} className="flex flex-wrap items-center gap-3">
            <CreateLink lang={lang} label={t.create} />
            <SoonButton label={t.createPay} soon={t.soon} />
            <WhatIsLink lang={lang} label={t.whatIs} />
          </m.div>
        </Stage>
      </div>
    </section>
  );
}
