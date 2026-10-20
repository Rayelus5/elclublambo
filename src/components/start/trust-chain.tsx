"use client";

import { useRef } from "react";
import { m, useScroll, useTransform, type MotionValue } from "motion/react";
import { rise, Stage, useMotionOn } from "./motion";

type Node = { handle: string; x: number; y: number; level: 0 | 1 | 2 };

// Invented members. Coordinates in % of the stage; each level is one round of invitations.
const NODES: Node[] = [
  { handle: "@marta", x: 50, y: 10, level: 0 },
  { handle: "@dani", x: 25, y: 50, level: 1 },
  { handle: "@iker", x: 75, y: 50, level: 1 },
  { handle: "@lucia", x: 12, y: 88, level: 2 },
  { handle: "@pablo", x: 38, y: 88, level: 2 },
  { handle: "@noa", x: 64, y: 88, level: 2 },
  { handle: "@sara", x: 88, y: 88, level: 2 },
];

const EDGES: [string, string][] = [
  ["@marta", "@dani"],
  ["@marta", "@iker"],
  ["@dani", "@lucia"],
  ["@dani", "@pablo"],
  ["@iker", "@noa"],
  ["@iker", "@sara"],
];

const at = (handle: string) => NODES.find((n) => n.handle === handle)!;
// Each round of invitations draws in its own slice of the scroll.
const SLICES = [
  [0, 0.15],
  [0.15, 0.5],
  [0.5, 0.85],
] as const;

/** One invitation: down from the inviter, across, down to the invitee. Plain boxes grown with transforms, in sequence. */
function Edge({ from, to, progress, on }: { from: Node; to: Node; progress: MotionValue<number>; on: boolean }) {
  const [a, b] = SLICES[to.level];
  const third = (b - a) / 3;
  const down = useTransform(progress, [a, a + third], [0, 1]);
  const across = useTransform(progress, [a + third, a + 2 * third], [0, 1]);
  const land = useTransform(progress, [a + 2 * third, b], [0, 1]);
  const mid = (from.y + to.y) / 2;
  const right = to.x >= from.x;
  return (
    <>
      <m.span
        className="absolute w-px origin-top bg-accent"
        style={{ left: `${from.x}%`, top: `${from.y}%`, height: `${mid - from.y}%`, ...(on ? { scaleY: down } : {}) }}
      />
      <m.span
        className={`absolute h-px bg-accent ${right ? "origin-left" : "origin-right"}`}
        style={{
          left: `${Math.min(from.x, to.x)}%`,
          width: `${Math.abs(to.x - from.x)}%`,
          top: `${mid}%`,
          ...(on ? { scaleX: across } : {}),
        }}
      />
      <m.span
        className="absolute w-px origin-top bg-accent"
        style={{ left: `${to.x}%`, top: `${mid}%`, height: `${to.y - mid}%`, ...(on ? { scaleY: land } : {}) }}
      />
    </>
  );
}

function Member({ node, progress, on }: { node: Node; progress: MotionValue<number>; on: boolean }) {
  const [, b] = SLICES[node.level];
  const opacity = useTransform(progress, [b - 0.08, b], [0, 1]);
  const scale = useTransform(progress, [b - 0.08, b], [0.4, 1]);
  const root = node.level === 0;
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${node.x}%`, top: `${node.y}%` }}>
      <m.div style={on && !root ? { opacity, scale } : undefined} className="flex flex-col items-center gap-2">
        <span className={`block ${root ? "size-4 bg-accent" : "size-3 border border-accent bg-bg"}`} />
        <span className="bg-bg px-1 font-mono text-[0.75rem] text-fg sm:text-small">{node.handle}</span>
      </m.div>
    </div>
  );
}

export function TrustChain() {
  const on = useMotionOn();
  const stage = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start 0.85", "end 0.5"] });
  return (
    <section aria-labelledby="start-cadena" className="border-t border-border">
      <div className="mx-auto grid w-full max-w-[1600px] items-center gap-16 px-4 py-24 sm:px-8 sm:py-32 lg:grid-cols-12">
        <Stage className="flex flex-col gap-6 lg:col-span-5">
          <m.h2 variants={rise} id="start-cadena" className="text-[clamp(2.5rem,6vw,5rem)] leading-[0.9] font-black tracking-[-0.04em]">
            La cadena de confianza
          </m.h2>
          <m.p variants={rise} className="text-[1.125rem]">
            Aquí no se entra buscando en Google. Solo entra quien recibe la invitación de un miembro, y cada miembro responde de a
            quién invita.
          </m.p>
          <m.p variants={rise} className="text-fg-muted">
            Por eso el club crece despacio y con gente que alguien de dentro conoce. Cada línea es una invitación, y todas tienen
            remitente.
          </m.p>
        </Stage>
        <div ref={stage} aria-hidden className="relative h-[20rem] w-full sm:h-[26rem] lg:col-span-7">
          {EDGES.map(([f, t]) => (
            <Edge key={t} from={at(f)} to={at(t)} progress={scrollYProgress} on={on} />
          ))}
          {NODES.map((n) => (
            <Member key={n.handle} node={n} progress={scrollYProgress} on={on} />
          ))}
        </div>
      </div>
    </section>
  );
}
