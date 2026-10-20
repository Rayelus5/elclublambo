"use client";

import { useRef, type ReactNode } from "react";
import { PenLine } from "lucide-react";
import { m, useScroll, useSpring } from "motion/react";
import { rise, Stage, useMotionOn } from "./motion";

const STEPS: { title: string; body: ReactNode; extra?: ReactNode }[] = [
  {
    title: "Te invita un miembro",
    body: "Alguien de dentro te pasa un enlace de invitación personal. Sin él no hay puerta.",
  },
  {
    title: "Abre el enlace con tu wallet",
    body: "Ábrelo en el navegador donde tengas MetaMask u OKX instalada, con la red Linea.",
    extra: (
      <ul className="flex flex-wrap gap-2">
        {["MetaMask", "OKX Wallet", "Red Linea"].map((t) => (
          <li key={t} className="border border-border-strong px-2 py-1 font-mono text-[0.75rem] text-fg rounded-control">
            {t}
          </li>
        ))}
      </ul>
    ),
  },
  {
    title: "Firma para entrar",
    body: "Tu wallet te pide firmar un mensaje. Firmar no cuesta gas ni mueve fondos: solo demuestra que la wallet es tuya.",
    extra: (
      <div aria-hidden className="flex max-w-[24rem] flex-col gap-2 border border-border bg-surface p-4 font-mono text-[0.75rem] rounded-panel">
        <span className="flex items-center gap-2 text-fg">
          <PenLine className="size-3.5 text-accent" strokeWidth={1.75} />
          Solicitud de firma
        </span>
        <span className="text-fg-muted">elclub.party quiere que inicies sesión con tu cuenta de Linea.</span>
        <span className="flex justify-between border-t border-border pt-2 text-fg">
          <span>Coste</span>
          <span className="text-accent">0 gas</span>
        </span>
      </div>
    ),
  },
];

export function HowToJoin() {
  const on = useMotionOn();
  const list = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: list, offset: ["start 0.7", "end 0.6"] });
  const fill = useSpring(scrollYProgress, { stiffness: 120, damping: 24, restDelta: 0.001 });
  return (
    <section aria-labelledby="start-entrar" className="border-t border-border">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-24 sm:px-8 sm:py-32">
        <Stage className="flex flex-col gap-6">
          <m.h2 variants={rise} id="start-entrar" className="text-[clamp(2.5rem,6vw,5rem)] leading-[0.9] font-black tracking-[-0.04em]">
            Cómo se entra
          </m.h2>
          <m.p variants={rise} className="max-w-[36rem] text-fg-muted">
            Tres pasos y ninguna contraseña. Tu wallet es tu llave.
          </m.p>
        </Stage>
        <div className="relative mt-16 max-w-[48rem]">
          <span aria-hidden className="absolute top-2 bottom-2 left-[7px] w-px bg-border-strong">
            <m.span style={on ? { scaleY: fill } : undefined} className="block h-full w-full origin-top bg-accent" />
          </span>
          <ol ref={list} className="flex flex-col gap-16 pl-12 sm:pl-20">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative">
              <span aria-hidden className="absolute top-2 -left-12 block size-[15px] border border-accent bg-bg sm:-left-20" />
              <Stage className="flex flex-col gap-4">
                <m.p variants={rise} className="font-mono text-small tracking-wide text-accent uppercase">
                  Paso {i + 1}
                </m.p>
                <m.h3 variants={rise} className="text-[clamp(1.75rem,3.6vw,3rem)] leading-[1] font-black tracking-[-0.03em]">
                  {s.title}
                </m.h3>
                <m.p variants={rise} className="max-w-[36rem] text-[1.0625rem] text-fg-muted">
                  {s.body}
                </m.p>
                {s.extra ? <m.div variants={rise}>{s.extra}</m.div> : null}
              </Stage>
            </li>
          ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
