"use client";

import { useEffect, useRef } from "react";
import { m, useMotionValue, useScroll, useTransform } from "motion/react";
import { useMotionOn } from "./motion";

const TICKER = [
  "Alpha · contrato verificado",
  "Bounty · 150 USDC",
  "Propina · 0,005 ETH",
  "Sorteo · commit-reveal",
  "Encuesta · voto secreto",
  "Tesorería · Safe 2-de-3",
  "Redes · Base y Arbitrum",
];

/**
 * The hero is the page's thesis: «ElClub.» at full width, its period the cyan square that runs through the page.
 * Scrolling holds the hero (sticky) while that square grows until it floods the screen, handing over to the cyan
 * manifesto below. Without motion it is a still, full-height hero; the h1 is plain server HTML (fast LCP).
 */
export function Hero() {
  const on = useMotionOn();
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end end"] });

  // The scale at which the square covers the whole stage, from its centre to the farthest corner.
  const fill = useMotionValue(80);
  useEffect(() => {
    const measure = () => {
      const s = stage.current?.getBoundingClientRect();
      const d = dot.current;
      if (!s || !d || !d.offsetWidth) return;
      const r = d.getBoundingClientRect();
      const cx = r.left + r.width / 2 - s.left;
      const cy = r.top + r.height / 2 - s.top;
      const reach = Math.hypot(Math.max(cx, s.width - cx), Math.max(cy, s.height - cy));
      fill.set((2 * reach) / d.offsetWidth + 2);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fill]);

  const dotScale = useTransform(() => {
    const p = Math.min(Math.max((scrollYProgress.get() - 0.12) / 0.68, 0), 1);
    // Ease-in: slow at first, then it swallows the screen.
    return 1 + (fill.get() - 1) * p * p * p;
  });
  const gridY = useTransform(scrollYProgress, [0, 1], ["0%", "-18%"]);
  const titleX = useTransform(scrollYProgress, [0, 0.8], ["0%", "-6%"]);
  const copyY = useTransform(scrollYProgress, [0, 0.5], ["0rem", "-6rem"]);
  const copyOpacity = useTransform(scrollYProgress, [0.05, 0.4], [1, 0]);

  return (
    <section ref={section} aria-labelledby="start-hero" className="relative motion-safe:h-[200svh]">
      <div ref={stage} className="sticky top-0 flex h-svh min-h-[34rem] flex-col overflow-hidden">
        {/* Layer 0: the grid, slower than the page. */}
        <m.div
          aria-hidden
          style={on ? { y: gridY } : undefined}
          className="pointer-events-none absolute inset-x-0 -top-px h-[130%] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:linear-gradient(to_bottom,black_30%,transparent_85%)]"
        />

        <div className="relative mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 pt-6 sm:px-8 sm:pt-8">
          <p className="flex items-center gap-3 font-mono text-small tracking-wide text-fg-muted uppercase">
            <span aria-hidden className="inline-block size-2 bg-accent" />
            Foro privado · Base y Arbitrum
          </p>

          <div className="flex flex-1 flex-col justify-center gap-8 py-10 sm:gap-10">
            <m.h1
              id="start-hero"
              // The period is drawn (the cyan square): the name keeps it without a stray space.
              aria-label="ElClub."
              style={on ? { x: titleX } : undefined}
              className="relative z-10 text-[clamp(3.75rem,22vw,19rem)] leading-[0.8] font-black tracking-[-0.055em] whitespace-nowrap"
            >
              ElClub
              <span className="sr-only">.</span>
              <span aria-hidden className="ml-[0.03em] inline-block animate-start-pop motion-reduce:animate-none">
                <m.span
                  ref={dot}
                  style={on ? { scale: dotScale } : undefined}
                  className="inline-block size-[0.19em] bg-accent will-change-transform"
                />
              </span>
            </m.h1>

            <m.div
              style={on ? { y: copyY, opacity: copyOpacity } : undefined}
              className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"
            >
              <div className="flex max-w-[38rem] flex-col gap-3">
                <p className="animate-start-rise font-display text-[clamp(1.375rem,3.2vw,2.25rem)] leading-[1.1] font-extrabold semiwide text-fg motion-reduce:animate-none">
                  El foro privado para quien se toma cripto en serio.
                </p>
                <p className="animate-start-rise text-fg-muted [animation-delay:120ms] motion-reduce:animate-none">
                  Solo con invitación. Sin ruido. Construido en Base y Arbitrum.
                </p>
              </div>
              <a
                href="#ruido"
                className="group flex min-h-11 items-center gap-3 self-start font-mono text-small tracking-wide text-fg-muted uppercase no-underline hover:text-fg sm:self-auto"
              >
                Desliza
                <span aria-hidden className="relative block h-10 w-px overflow-hidden bg-border-strong">
                  <span className="absolute inset-x-0 top-0 block h-1/2 animate-start-cue bg-accent motion-reduce:animate-none" />
                </span>
              </a>
            </m.div>
          </div>
        </div>

        {/* Layer 2: what is inside, passing by. */}
        <div aria-hidden className="relative overflow-hidden border-t border-border bg-bg py-3">
          <div className="flex w-max animate-start-marquee motion-reduce:animate-none">
            {[0, 1].map((copy) => (
              <ul key={copy} className="flex shrink-0 items-center font-mono text-small text-fg-muted uppercase">
                {TICKER.map((item) => (
                  <li key={item} className="flex items-center gap-6 px-6 whitespace-nowrap">
                    <span className="inline-block size-1.5 bg-accent" />
                    {item}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
