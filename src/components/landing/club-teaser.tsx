"use client";

import { m } from "motion/react";
import { Lock } from "lucide-react";
import { grow, rise, Stage } from "@/components/start/motion";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { WhatIsLink } from "./final-cta";

// Redacted rows of a forum you cannot read from outside: widths only, no content.
const ROWS = ["w-[72%]", "w-[54%]", "w-[86%]", "w-[40%]", "w-[64%]"];

/** The reward: the club itself, behind the door. */
export function ClubTeaser({ lang, t, whatIs }: { lang: Lang; t: Dictionary["landing"]["club"]; whatIs: string }) {
  return (
    <section aria-labelledby="landing-club" className="border-t border-border bg-surface">
      <div className="mx-auto grid w-full max-w-[1600px] items-center gap-12 px-4 py-24 sm:px-8 sm:py-32 lg:grid-cols-12">
        <Stage className="flex flex-col items-start gap-6 lg:col-span-6">
          <m.h2
            variants={rise}
            id="landing-club"
            className="text-[clamp(2.25rem,5vw,4.5rem)] leading-[0.95] font-black tracking-[-0.045em] text-fg"
          >
            {t.title}
          </m.h2>
          <m.p variants={rise} className="max-w-[32rem] text-[1.0625rem] text-fg-muted">
            {t.lead}
          </m.p>
          <m.div variants={rise}>
            <WhatIsLink lang={lang} label={whatIs} />
          </m.div>
        </Stage>
        <div aria-hidden className="lg:col-span-5 lg:col-start-8">
          <Stage className="flex flex-col gap-4 border border-border-strong bg-bg p-5 rounded-panel sm:p-6" gap={0.07}>
            <m.p variants={rise} className="flex items-center gap-2 font-mono text-[0.75rem] text-fg-muted uppercase">
              <Lock className="size-3.5 text-accent" strokeWidth={2.25} />
              {t.locked}
            </m.p>
            {ROWS.map((width) => (
              <div key={width} className="flex items-center gap-3">
                <span className="size-7 shrink-0 bg-surface-2 rounded-control" />
                <span className="flex-1">
                  <m.span variants={grow} className={`block h-2.5 origin-left bg-surface-2 rounded-control ${width}`} />
                </span>
              </div>
            ))}
          </Stage>
        </div>
      </div>
    </section>
  );
}
