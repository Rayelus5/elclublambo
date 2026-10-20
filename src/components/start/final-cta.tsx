"use client";

import { useRef } from "react";
import { m, useScroll, useTransform } from "motion/react";
import { TREASURY_NOTICE } from "./features";
import { rise, Stage, useMotionOn } from "./motion";

export function FinalCta() {
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
            La puerta, de momento, está entornada.
          </m.h2>
          <m.p variants={rise} className="max-w-[36rem] text-[1.125rem] text-fg-muted">
            Ahora mismo solo entran miembros seleccionados. Pronto podrás pedir tu invitación desde aquí.
          </m.p>
          <m.div variants={rise}>
            <button
              type="button"
              aria-disabled="true"
              className="inline-flex min-h-12 cursor-not-allowed items-center gap-3 border border-border-strong bg-surface px-5 py-3 font-bold text-fg-muted rounded-control"
            >
              Solicitar invitación
              <span className="border border-accent px-2 py-0.5 font-mono text-[0.75rem] font-normal tracking-wide text-accent uppercase rounded-control">
                Próximamente
              </span>
            </button>
          </m.div>
          <m.p variants={rise} className="max-w-[36rem] border-l-2 border-accent bg-bg pl-4">
            <strong className="font-bold text-fg">¿Ya tienes invitación?</strong> Abre el enlace que te pasaron en tu navegador de
            preferencia (con tu wallet instalada) y desde ahí inicia sesión.
          </m.p>
        </Stage>
      </div>
    </section>
  );
}

/** Page footer: the short treasury notice. */
export function StartFooter() {
  return (
    <footer className="border-t border-border bg-bg">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-10 text-small text-fg-muted sm:px-8 lg:flex-row lg:items-start lg:justify-between">
        <p className="shrink-0 font-display text-lg leading-none font-black whitespace-nowrap text-fg wide">
          ElClub
          <span className="sr-only">.</span>
          <span aria-hidden className="ml-[0.06em] inline-block size-[0.22em] bg-accent" />
        </p>
        <p className="max-w-[44rem]">
          Tesorería: fondo común en una Safe multifirma 2-de-3 en Linea. {TREASURY_NOTICE}
        </p>
        <p className="font-mono text-[0.75rem]">Construido en Linea</p>
      </div>
    </footer>
  );
}
