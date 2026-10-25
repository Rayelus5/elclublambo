"use client";

import { useRef } from "react";
import { Hash, MessageSquare, ShieldCheck } from "lucide-react";
import { m, useScroll, useTransform, type MotionValue } from "motion/react";
import type { StartDict } from "./dict";
import { useMotionOn } from "./motion";

/** Lights up word by word as it scrolls through the screen. */
function Word({ word, index, total, progress, on }: { word: string; index: number; total: number; progress: MotionValue<number>; on: boolean }) {
  const start = index / total;
  const opacity = useTransform(progress, [start, start + 1 / total], [0.22, 1]);
  return (
    <m.span style={on ? { opacity } : undefined} className="inline">
      {word}{" "}
    </m.span>
  );
}

type Noise = { who: string; top: string; left: string; dx: number; dy: number; r: number; wide?: boolean };

// Invented chat noise (the messages are in the dictionary, in this same order). `dx`/`dy` (rem) and `r` (deg): where each one is blown to as the signal arrives.
const NOISE: Noise[] = [
  { who: "anon_4821", top: "4%", left: "2%", dx: -18, dy: -10, r: -14 },
  { who: "luna_moon", top: "8%", left: "56%", dx: 20, dy: -12, r: 10, wide: true },
  { who: "pepe_trader", top: "30%", left: "-2%", dx: -24, dy: 2, r: -8, wide: true },
  { who: "alpha_dm", top: "34%", left: "70%", dx: 22, dy: 4, r: 12 },
  { who: "bot_9912", top: "62%", left: "4%", dx: -20, dy: 12, r: 9 },
  { who: "anon_0007", top: "84%", left: "28%", dx: -6, dy: 22, r: -18 },
  { who: "moonboy", top: "70%", left: "62%", dx: 20, dy: 16, r: -10, wide: true },
  { who: "maria_eth", top: "88%", left: "66%", dx: 12, dy: 24, r: 7, wide: true },
  { who: "anon_3310", top: "18%", left: "34%", dx: 2, dy: -22, r: 16, wide: true },
];

export function NoiseToSignal({ t }: { t: StartDict }) {
  const on = useMotionOn();
  const manifesto = useRef<HTMLParagraphElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const { scrollYProgress: read } = useScroll({ target: manifesto, offset: ["start 0.85", "end 0.45"] });
  const { scrollYProgress: blow } = useScroll({ target: stage, offset: ["start start", "end end"] });
  const signalOpacity = useTransform(blow, [0.35, 0.65], [0, 1]);
  const signalScale = useTransform(blow, [0.35, 0.75], [0.86, 1]);
  const signalY = useTransform(blow, [0.35, 0.75], ["3rem", "0rem"]);
  const words = t.noise.manifesto.split(" ");

  return (
    <section id="ruido" aria-labelledby="start-ruido" className="scroll-mt-0">
      {/* The Cerulean the hero's square flooded the screen with. */}
      <div className="bg-accent text-bg">
        <div className="mx-auto flex min-h-svh w-full max-w-[1600px] flex-col justify-center gap-10 px-4 py-24 sm:px-8">
          <h2 id="start-ruido" className="font-mono text-small font-normal tracking-wide uppercase">
            {t.noise.kicker}
          </h2>
          <p
            ref={manifesto}
            className="max-w-[22ch] font-display text-[clamp(2.25rem,6.4vw,6rem)] leading-[1] font-black tracking-[-0.03em] wide [text-wrap:balance]"
          >
            {words.map((w, i) => (
              <Word key={i} word={w} index={i} total={words.length} progress={read} on={on} />
            ))}
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1600px] px-4 pt-24 sm:px-8">
        <p className="max-w-[40rem] font-display text-[clamp(1.5rem,3.4vw,2.5rem)] leading-[1.1] font-extrabold">
          {t.noise.leadBefore} <span className="text-accent">{t.noise.leadAccent}</span> {t.noise.leadAfter}
        </p>
        <p className="mt-4 max-w-[36rem] text-fg-muted">
          {t.noise.body}
        </p>
      </div>

      <div ref={stage} className="relative motion-safe:h-[220svh]">
        <div className="sticky top-0 flex h-svh min-h-[36rem] items-center justify-center overflow-hidden px-4 sm:px-8">
          <div aria-hidden className="relative h-[min(78svh,40rem)] w-full max-w-[64rem]">
            {NOISE.map((n, i) => (
              <NoiseItem key={n.who} n={n} text={t.noise.chatter[i] ?? ""} progress={blow} on={on} />
            ))}
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <m.div
                style={on ? { opacity: signalOpacity, scale: signalScale, y: signalY } : undefined}
                className="w-full max-w-[30rem] border border-accent bg-surface p-5 rounded-panel sm:p-6"
              >
                <SignalThread t={t} />
              </m.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function NoiseItem({ n, text, progress, on }: { n: Noise; text: string; progress: MotionValue<number>; on: boolean }) {
  const x = useTransform(progress, [0.1, 0.6], ["0rem", `${n.dx}rem`]);
  const y = useTransform(progress, [0.1, 0.6], ["0rem", `${n.dy}rem`]);
  const rotate = useTransform(progress, [0.1, 0.6], [0, n.r]);
  const opacity = useTransform(progress, [0.25, 0.55], [1, 0]);
  return (
    <div className={`absolute ${n.wide ? "hidden sm:block" : ""}`} style={{ top: n.top, left: n.left }}>
      <m.div
        style={on ? { x, y, rotate, opacity } : undefined}
        className="max-w-[16rem] border border-border bg-surface px-3 py-2 font-mono text-small text-fg-muted rounded-control"
      >
        <span className="block text-[0.6875rem] opacity-70">{n.who}</span>
        {text}
      </m.div>
    </div>
  );
}

/** The signal: one tidy thread, as it looks inside. */
function SignalThread({ t }: { t: StartDict }) {
  const th = t.noise.thread;
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 font-mono text-small text-fg-muted">
        <Hash className="size-4 text-accent" strokeWidth={1.75} />
        {th.channel}
      </p>
      <div className="flex flex-col gap-2">
        <p className="font-display text-xl leading-tight font-extrabold semiwide">{th.title}</p>
        <p className="text-small text-fg-muted">@marta · {th.ago}</p>
        <p className="text-[0.9375rem]">{th.body}</p>
        <p className="inline-flex w-fit items-center gap-1.5 border border-border-strong px-2 py-0.5 font-mono text-[0.75rem] text-accent rounded-control">
          <ShieldCheck className="size-3.5" strokeWidth={1.75} />
          {th.chip}
        </p>
      </div>
      <ul className="flex flex-col gap-2 border-l border-border-strong pl-4 text-[0.9375rem]">
        <li>
          <span className="text-fg-muted">@dani</span> {th.replyOne}
        </li>
        <li>
          <span className="text-fg-muted">@iker</span> {th.replyTwo}
        </li>
      </ul>
      <p className="flex items-center gap-2 font-mono text-[0.75rem] text-fg-muted">
        <MessageSquare className="size-3.5" strokeWidth={1.75} />
        {th.stats}
      </p>
    </div>
  );
}
