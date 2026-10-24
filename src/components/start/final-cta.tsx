"use client";

import { useRef } from "react";
import { m, useScroll, useTransform } from "motion/react";
import type { StartDict } from "./dict";
import { rise, Stage, useMotionOn } from "./motion";

export function FinalCta({ t }: { t: StartDict }) {
  const on = useMotionOn();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const wordX = useTransform(scrollYProgress, [0, 1], ["12%", "-4%"]);
  const dotScale = useTransform(scrollYProgress, [0.2, 1], [0.2, 1]);
  const dotRotate = useTransform(scrollYProgress, [0.2, 1], [-45, 0]);

  return (
    <section ref={ref} aria-labelledby="start-puerta" className="relative overflow-hidden border-t border-border">
      {/* Back layers: the name in outline drifting sideways, and the square coming back to rest. */}
      <m.p
        aria-hidden
        style={on ? { x: wordX } : undefined}
        className="pointer-events-none absolute -bottom-[0.12em] left-0 font-display text-[clamp(7rem,30vw,28rem)] leading-none font-black tracking-[-0.06em] whitespace-nowrap text-transparent wide [-webkit-text-stroke:1px_var(--border-strong)] select-none"
      >
        ElClub.
      </m.p>
      <m.span
        aria-hidden
        style={on ? { scale: dotScale, rotate: dotRotate } : undefined}
        className="pointer-events-none absolute top-10 right-[6%] block size-[clamp(3rem,12vw,10rem)] sm:top-16 bg-accent"
      />

      <div className="relative mx-auto flex w-full max-w-[1600px] flex-col gap-10 px-4 pt-28 pb-[clamp(10rem,28vw,24rem)] sm:px-8 sm:pt-40">
        <Stage className="flex max-w-[52rem] flex-col gap-8">
          <m.h2 variants={rise} id="start-puerta" className="text-[clamp(3rem,9vw,8rem)] leading-[0.85] font-black tracking-[-0.045em]">
            {t.final.title}
          </m.h2>
          <m.p variants={rise} className="max-w-[36rem] text-[1.125rem] text-fg-muted">
            {t.final.lead}
          </m.p>
          <m.div variants={rise}>
            <button
              type="button"
              aria-disabled="true"
              className="inline-flex min-h-12 cursor-not-allowed items-center gap-3 border border-border-strong bg-surface px-5 py-3 font-bold text-fg-muted rounded-control"
            >
              {t.final.request}
              <span className="border border-accent px-2 py-0.5 font-mono text-[0.75rem] font-normal tracking-wide text-accent uppercase rounded-control">
                {t.final.soon}
              </span>
            </button>
          </m.div>
          <m.p variants={rise} className="max-w-[36rem] border-l-2 border-accent bg-bg pl-4">
            <strong className="font-bold text-fg">{t.final.invitedStrong}</strong> {t.final.invitedRest}
          </m.p>
        </Stage>
      </div>
    </section>
  );
}

/** The treasury notice, kept on /start (the shared PublicFooter only carries the no-custody line). */
export function DonationsNote({ t }: { t: StartDict }) {
  return (
    <div className="border-t border-border bg-bg">
      <p className="mx-auto w-full max-w-[1600px] px-4 py-6 text-small text-fg-muted sm:px-8">
        {t.donationsNote} {t.features.treasuryNotice}
      </p>
    </div>
  );
}
