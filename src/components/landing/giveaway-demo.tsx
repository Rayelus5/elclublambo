"use client";

import { useRef, type ReactNode } from "react";
import { m, useScroll, type Variants } from "motion/react";
import { Check } from "lucide-react";
import { EASE_OUT, pop, rise, Stage, useMotionOn } from "@/components/start/motion";
import type { Dictionary } from "@/lib/i18n";

/*
 * A static, invented giveaway, but a consistent one: commit = keccak256(seed) and the winner is what drawWinners() gives
 * for this seed, this randomness and 12 entries (a unit test pins both). No network call: drand is only named.
 */
export const DEMO = {
  seed: "0xe36347b81bcd6861b9ef900f1d082cf62b65ad52a7d3a429cd2af7293532a107",
  commit: "0x11ab9e45959da68e8da1dd73f80a76d09fe519f8033a376351658d7607958091",
  round: 33361011,
  randomness: "0x363375b2440c8943deab6489476d2cd59f9a506206873d9b3d7aff104792339d",
  entries: [
    "0x3f2a…91c4",
    "0x8b07…e1d2",
    "0xc41e…07ab",
    "0x1d9f…5a30",
    "0x77ac…c2e9",
    "0xe0b3…48f1",
    "0x5a6d…b917",
    "0x92f4…0d6c",
    "0x2c18…f7a5",
    "0x9c1e…44fa",
    "0x6e53…a08b",
    "0xb4d7…3e62",
  ],
  winner: 10,
} as const;

/** The winner's frame lights up last, after the grid has settled. */
const light: Variants = {
  hide: { opacity: 0, scale: 1.15, transition: { duration: 0 } },
  show: { opacity: 1, scale: 1, transition: { duration: 0.45, ease: EASE_OUT, delay: 0.7 } },
};

function Step({ n, title, text, children }: { n: number; title: string; text: string; children: ReactNode }) {
  return (
    <li className="relative pl-10 sm:pl-14">
      <span
        aria-hidden
        className="absolute top-1 left-0 flex size-[1.875rem] items-center justify-center border border-accent bg-bg font-mono text-small font-bold text-accent"
      >
        {n}
      </span>
      <Stage className="flex flex-col gap-4" gap={0.1} amount={0.3}>
        <m.h3 variants={rise} className="text-[clamp(1.5rem,3vw,2.25rem)] leading-none font-black tracking-[-0.03em] text-fg">
          {title}
        </m.h3>
        <m.p variants={rise} className="max-w-[34rem] text-fg-muted">
          {text}
        </m.p>
        {children}
      </Stage>
    </li>
  );
}

const box = "border border-border-strong bg-surface p-4 font-mono text-[0.8125rem] leading-relaxed rounded-panel sm:p-5";

export function GiveawayDemo({ t, sample }: { t: Dictionary["landing"]["demo"]; sample: string }) {
  const on = useMotionOn();
  const rail = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: rail, offset: ["start 0.75", "end 0.55"] });

  return (
    <section aria-labelledby="landing-demo" className="border-t border-border">
      <div className="mx-auto grid w-full max-w-[1600px] gap-14 px-4 py-24 sm:px-8 sm:py-32 lg:grid-cols-12 lg:gap-16">
        <Stage className="flex flex-col gap-6 self-start lg:sticky lg:top-12 lg:col-span-5">
          <m.h2
            variants={rise}
            id="landing-demo"
            className="text-[clamp(2.5rem,5vw,4.75rem)] leading-[0.9] font-black tracking-[-0.045em] text-fg"
          >
            {t.title}
          </m.h2>
          <m.p variants={rise} className="max-w-[32rem] text-[1.125rem]">
            {t.lead}
          </m.p>
          <m.p variants={rise} className="flex items-center gap-2 font-mono text-small tracking-wide text-fg-muted uppercase">
            <span aria-hidden className="inline-block size-1.5 bg-accent" />
            {sample}
          </m.p>
        </Stage>

        <ol ref={rail} aria-label={t.stepsLabel} className="relative flex flex-col gap-16 sm:gap-20 lg:col-span-7">
          {/* The rail: grey track, cyan fill drawn by the scroll (full when motion is off). */}
          <span aria-hidden className="absolute top-2 bottom-2 left-[0.9375rem] w-px bg-border-strong" />
          <m.span
            aria-hidden
            style={on ? { scaleY: scrollYProgress } : undefined}
            className="absolute top-2 bottom-2 left-[0.9375rem] w-px origin-top bg-accent"
          />

          <Step n={1} title={t.commitTitle} text={t.commitText}>
            <m.p variants={rise} className={`${box} break-all text-fg`}>
              {DEMO.commit}
            </m.p>
          </Step>

          <Step n={2} title={t.roundTitle} text={t.roundText}>
            <m.div variants={rise} className={`${box} flex flex-col gap-2`}>
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-fg-muted">{t.round}</span>
                <m.span variants={pop} className="inline-block font-display text-[1.5rem] font-black tracking-[-0.02em] text-accent tabular-nums">
                  #{DEMO.round}
                </m.span>
              </p>
              <p className="break-all text-fg-muted">{DEMO.randomness}</p>
            </m.div>
          </Step>

          <Step n={3} title={t.winnerTitle} text={t.winnerText}>
            <m.ol variants={rise} aria-label={t.entries} className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
              {DEMO.entries.map((address, i) => {
                const position = i + 1;
                const won = position === DEMO.winner;
                return (
                  <li
                    key={address}
                    className={`relative flex min-w-0 flex-col gap-1 border p-2.5 font-mono text-[0.75rem] rounded-panel ${
                      won ? "border-accent bg-surface-2 text-fg" : "border-border bg-surface text-fg-muted"
                    }`}
                  >
                    <span className={`text-[0.8125rem] font-bold tabular-nums ${won ? "text-accent" : "text-fg"}`}>
                      <span className="sr-only">{t.position} </span>#{position}
                    </span>
                    <span className="truncate">{address}</span>
                    {won ? (
                      <>
                        <m.span aria-hidden variants={light} className="pointer-events-none absolute -inset-1 border-2 border-accent rounded-panel" />
                        <m.span
                          variants={pop}
                          className="absolute -top-3 right-2 inline-flex items-center gap-1 bg-accent px-1.5 py-0.5 text-[0.75rem] font-bold text-accent-foreground uppercase rounded-control"
                        >
                          <Check aria-hidden className="size-3" strokeWidth={3} />
                          {t.wins}
                        </m.span>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </m.ol>
          </Step>
        </ol>
      </div>
    </section>
  );
}
