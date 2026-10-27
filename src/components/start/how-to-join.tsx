"use client";

import { useRef } from "react";
import { PenLine } from "lucide-react";
import { m, useScroll, useSpring } from "motion/react";
import type { StartDict } from "./dict";
import { rise, Stage, useMotionOn } from "./motion";

/** What goes under steps 2 and 3: the supported wallets and a mock of the signature request. */
function Extra({ index, t }: { index: number; t: StartDict }) {
  const j = t.join;
  if (index === 1) {
    return (
      <ul className="flex flex-wrap gap-2">
        {j.chips.map((c) => (
          <li key={c} className="border border-border-strong px-2 py-1 font-mono text-[0.75rem] text-fg rounded-control">
            {c}
          </li>
        ))}
      </ul>
    );
  }
  if (index === 2) {
    return (
      <div aria-hidden className="flex max-w-[24rem] flex-col gap-2 border border-border bg-surface p-4 font-mono text-[0.75rem] rounded-panel">
        <span className="flex items-center gap-2 text-fg">
          <PenLine className="size-3.5 text-accent" strokeWidth={1.75} />
          {j.signRequest}
        </span>
        <span className="text-fg-muted">{j.signText}</span>
        <span className="flex justify-between border-t border-border pt-2 text-fg">
          <span>{j.cost}</span>
          <span className="text-accent">{j.gas}</span>
        </span>
      </div>
    );
  }
  return null;
}

export function HowToJoin({ t }: { t: StartDict }) {
  const on = useMotionOn();
  const list = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: list, offset: ["start 0.7", "end 0.6"] });
  const fill = useSpring(scrollYProgress, { stiffness: 120, damping: 24, restDelta: 0.001 });
  return (
    <section aria-labelledby="start-entrar" className="border-t border-border">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-24 sm:px-8 sm:py-32">
        <Stage className="flex flex-col gap-6">
          <m.h2 variants={rise} id="start-entrar" className="text-[clamp(2.5rem,6vw,5rem)] leading-[0.9] font-black tracking-[-0.04em]">
            {t.join.title}
          </m.h2>
          <m.p variants={rise} className="max-w-[36rem] text-fg-muted">
            {t.join.lead}
          </m.p>
        </Stage>
        <div className="relative mt-16 max-w-[48rem]">
          <span aria-hidden className="absolute top-2 bottom-2 left-[7px] w-px bg-border-strong">
            <m.span style={on ? { scaleY: fill } : undefined} className="block h-full w-full origin-top bg-accent" />
          </span>
          <ol ref={list} className="flex flex-col gap-16 pl-12 sm:pl-20">
            {t.join.steps.map((s, i) => (
              <li key={i} className="relative">
                <span aria-hidden className="absolute top-2 -left-12 block size-[15px] border border-accent bg-bg sm:-left-20" />
                <Stage className="flex flex-col gap-4">
                  <m.p variants={rise} className="font-mono text-small tracking-wide text-accent uppercase">
                    {t.join.step} {i + 1}
                  </m.p>
                  <m.h3 variants={rise} className="text-[clamp(1.75rem,3.6vw,3rem)] leading-[1] font-black tracking-[-0.03em]">
                    {s.title}
                  </m.h3>
                  <m.p variants={rise} className="max-w-[36rem] text-[1.0625rem] text-fg-muted">
                    {s.body}
                  </m.p>
                  {i > 0 ? (
                    <m.div variants={rise}>
                      <Extra index={i} t={t} />
                    </m.div>
                  ) : null}
                </Stage>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
