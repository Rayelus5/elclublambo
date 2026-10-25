"use client";

import { useRef } from "react";
import { m, useScroll, useTransform } from "motion/react";
import { Check, ShieldAlert } from "lucide-react";
import { useMotionOn } from "@/components/start/motion";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { DEMO } from "./giveaway-demo";
import { CreateLink, WhatIsLink } from "./final-cta";

const short = (hex: string) => `${hex.slice(0, 10)}…${hex.slice(-6)}`;
const row = "flex items-baseline justify-between gap-4 border-t border-border py-2.5 first:border-t-0";

/**
 * The hero states the thesis (open, honest tools) and shows the proof beside it: three tool cards stacked like papers,
 * the giveaway receipt on top. Scrolling fans them apart. Decorative: the blocks below say the same in words.
 */
function ProofStack({ t }: { t: Dictionary["landing"] }) {
  const on = useMotionOn();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.6", "end start"] });
  const backY = useTransform(scrollYProgress, [0, 1], ["0rem", "-4rem"]);
  const midY = useTransform(scrollYProgress, [0, 1], ["0rem", "-2rem"]);
  const frontY = useTransform(scrollYProgress, [0, 1], ["0rem", "1.5rem"]);

  return (
    <div ref={ref} aria-hidden className="relative mx-auto w-full max-w-[28rem] sm:pt-36 lg:mx-0 lg:ml-auto">
      {/* Back: the checker, tilted. */}
      <div className="absolute top-0 right-12 left-0 hidden -rotate-2 sm:block">
        <m.div style={on ? { y: backY } : undefined} className="border border-border bg-surface p-4 rounded-panel">
          <p className="mb-6 flex items-center justify-between font-mono text-[0.75rem] text-fg-muted uppercase">
            {t.checker.title}
            <span className="text-accent">{t.soon}</span>
          </p>
          <p className="flex items-center gap-2 text-small text-fg">
            <ShieldAlert className="size-4 shrink-0 text-danger" strokeWidth={2} />
            {t.checker.tax}
          </p>
        </m.div>
      </div>
      {/* Middle: the payment card. */}
      <div className="absolute top-16 right-0 left-10 hidden rotate-2 sm:block">
        <m.div style={on ? { y: midY } : undefined} className="border border-border-strong bg-surface-2 p-4 rounded-panel">
          <p className="mb-6 flex items-center justify-between font-mono text-[0.75rem] text-fg-muted uppercase">
            {t.pay.title}
            <span className="text-accent">{t.soon}</span>
          </p>
          <p className="font-display text-xl font-black tracking-[-0.02em] text-fg semiwide">25 USDC</p>
        </m.div>
      </div>
      {/* Front: the giveaway receipt. */}
      <m.div
        style={on ? { y: frontY } : undefined}
        className="relative border border-accent bg-bg p-5 shadow-[0_0_0_6px_var(--bg)] rounded-panel"
      >
        <p className="mb-3 flex items-center justify-between gap-3 font-mono text-[0.75rem] text-fg-muted uppercase">
          <span className="flex items-center gap-2">
            <span className="inline-block size-2 bg-accent" />
            drand · quicknet
          </span>
          <span>{t.sample}</span>
        </p>
        <dl className="font-mono text-[0.8125rem]">
          <div className={row}>
            <dt className="text-fg-muted">{t.demo.commitTitle}</dt>
            <dd className="truncate text-fg">{short(DEMO.commit)}</dd>
          </div>
          <div className={row}>
            <dt className="text-fg-muted">{t.demo.round}</dt>
            <dd className="text-fg tabular-nums">#{DEMO.round}</dd>
          </div>
          <div className={row}>
            <dt className="text-fg-muted">{t.demo.winnerTitle}</dt>
            <dd className="flex items-center gap-2 text-accent">
              <Check className="size-3.5" strokeWidth={3} />#{DEMO.winner} · {DEMO.entries[DEMO.winner - 1]}
            </dd>
          </div>
        </dl>
      </m.div>
    </div>
  );
}

export function Hero({ lang, t }: { lang: Lang; t: Dictionary["landing"] }) {
  return (
    <section aria-labelledby="landing-hero" className="relative overflow-hidden">
      {/* The grid: the same graph paper as /start, fading out downwards. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:linear-gradient(to_bottom,black_20%,transparent_90%)]"
      />
      <div className="relative mx-auto grid w-full max-w-[1600px] items-center gap-12 px-4 pt-12 pb-20 sm:px-8 sm:pt-20 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-12 lg:gap-8 lg:pb-24">
        <div className="flex flex-col gap-8 lg:col-span-7">
          <p className="flex items-center gap-3 font-mono text-small tracking-wide text-fg-muted uppercase">
            <span aria-hidden className="inline-block size-2 bg-accent" />
            {t.hero.kicker}
          </p>
          <h1
            id="landing-hero"
            className="text-[clamp(2rem,8.4vw,4.5rem)] leading-[0.92] font-black tracking-[-0.045em] text-fg lg:text-[clamp(3.5rem,5.2vw,6.5rem)]"
          >
            {t.hero.title}
          </h1>
          <p className="max-w-[34rem] animate-start-rise text-[1.125rem] text-fg-muted motion-reduce:animate-none">{t.hero.lead}</p>
          <div
            role="group"
            aria-label={t.hero.actions}
            className="flex animate-start-rise flex-wrap items-center gap-3 [animation-delay:120ms] motion-reduce:animate-none"
          >
            <CreateLink lang={lang} label={t.create} />
            <WhatIsLink lang={lang} label={t.whatIs} />
          </div>
        </div>
        <div className="lg:col-span-5">
          <ProofStack t={t} />
        </div>
      </div>
    </section>
  );
}
