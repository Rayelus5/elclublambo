"use client";

import { useRef, type ComponentType, type ReactNode } from "react";
import { ChartCandlestick, Coins, Dices, Gavel, HandCoins, Landmark, MessagesSquare, ShieldCheck, type LucideProps } from "lucide-react";
import { m, useScroll, useTransform } from "motion/react";
import { AlphaMock, BountyMock, ChatMock, MarketMock, ModerationMock, RafflePollMock, TipsMock, TreasuryMock } from "./mocks";
import { rise, Stage, useMotionOn } from "./motion";

export const TREASURY_NOTICE =
  "ElClub. no custodia fondos. Donar no da derechos económicos: es voluntario, no es una inversión ni promete rentabilidad.";

type Feature = {
  id: string;
  icon: ComponentType<LucideProps>;
  label: string;
  title: string;
  body: string;
  notice?: string;
  tags: string[];
  path: string;
  Mock: ComponentType;
};

const FEATURES: Feature[] = [
  {
    id: "chat",
    icon: MessagesSquare,
    label: "Chat",
    title: "Canales y chat en tiempo real",
    body: "Canales por tema y conversación en directo, con hilos para no mezclar temas, menciones, reacciones y encuestas sin salir del chat.",
    tags: ["Hilos", "Menciones", "Reacciones", "Encuestas"],
    path: "/c/trading",
    Mock: ChatMock,
  },
  {
    id: "alphas",
    icon: ShieldCheck,
    label: "Alphas",
    title: "Alphas con contrato verificado",
    body: "Cada alpha lleva su contrato, comprobado on-chain, y el gráfico de DexScreener junto a la tesis. Sin capturas recortadas ni tickers inventados.",
    tags: ["On-chain", "DexScreener"],
    path: "/c/alphas",
    Mock: AlphaMock,
  },
  {
    id: "bounties",
    icon: HandCoins,
    label: "Bounties",
    title: "Bounties: pide ayuda y págala",
    body: "Publica tu pregunta con una recompensa en ETH o USDC. Cuando llegue la buena, eliges la mejor respuesta y le pagas a quien la escribió.",
    tags: ["ETH", "USDC", "Mejor respuesta"],
    path: "/c/bounties",
    Mock: BountyMock,
  },
  {
    id: "propinas",
    icon: Coins,
    label: "Propinas",
    title: "Propinas de miembro a miembro",
    body: "Si alguien te ahorra un disgusto, dale las gracias en ETH o USDC. De wallet a wallet, y verificado on-chain.",
    tags: ["P2P", "ETH", "USDC"],
    path: "/u/marta",
    Mock: TipsMock,
  },
  {
    id: "donaciones",
    icon: Landmark,
    label: "Donaciones",
    title: "Donaciones",
    body: "Dona en Base o Arbitrum a la Safe del club. Sin retorno, con transparencia.",
    notice: TREASURY_NOTICE,
    tags: ["Mecenas", "Safe"],
    path: "/donar",
    Mock: TreasuryMock,
  },
  {
    id: "sorteos",
    icon: Dices,
    label: "Sorteos y encuestas",
    title: "Sorteos verificables y encuestas con voto secreto",
    body: "Los sorteos son gratis y el ganador sale de una ronda de drand: cualquiera puede comprobarlo en su navegador. En las encuestas secretas nadie ve los resultados hasta el cierre.",
    tags: ["drand", "Voto secreto"],
    path: "/sorteos",
    Mock: RafflePollMock,
  },
  {
    id: "mercado",
    icon: ChartCandlestick,
    label: "Mercado",
    title: "Mercado cripto integrado",
    body: "Precios, gráficos y la ficha de cada moneda que se comenta, sin abrir otra pestaña.",
    tags: ["Precios", "Gráficos"],
    path: "/mercado",
    Mock: MarketMock,
  },
  {
    id: "moderacion",
    icon: Gavel,
    label: "Moderación",
    title: "Moderación seria",
    body: "Roles al estilo Discord, canales con requisitos para entrar y un guardián de enlaces que te avisa antes de salir a un dominio que no conoces.",
    tags: ["Roles", "Requisitos", "Guardián de enlaces"],
    path: "/admin/roles",
    Mock: ModerationMock,
  },
];

/** The mock-up's frame: a window on the front, a hatched plate behind it moving at its own pace (layering). */
function Frame({ path, children }: { path: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const on = useMotionOn();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const back = useTransform(scrollYProgress, [0, 1], ["3rem", "-3rem"]);
  const front = useTransform(scrollYProgress, [0, 1], ["1.5rem", "-1.5rem"]);
  return (
    <div ref={ref} aria-hidden className="relative pr-3 pb-3 sm:pr-5 sm:pb-5">
      <m.div
        style={on ? { y: back } : undefined}
        className="absolute top-5 right-0 bottom-0 left-5 border border-border-strong bg-[repeating-linear-gradient(135deg,var(--border)_0_1px,transparent_1px_10px)] rounded-panel sm:top-8 sm:left-8"
      />
      <m.div style={on ? { y: front } : undefined} className="relative border border-border bg-surface rounded-panel">
        <span className="absolute -top-1 -left-1 size-2 bg-accent" />
        <div className="flex items-center justify-between border-b border-border px-4 py-2 font-mono text-[0.75rem] text-fg-muted">
          <span>elclub.party{path}</span>
          <span className="inline-block size-1.5 bg-success" />
        </div>
        {children}
      </m.div>
    </div>
  );
}

function FeatureRow({ feature, flip }: { feature: Feature; flip: boolean }) {
  const { icon: Icon, Mock } = feature;
  return (
    <article aria-labelledby={`start-f-${feature.id}`} className="grid items-center gap-10 border-t border-border py-16 sm:py-24 lg:grid-cols-12 lg:gap-16">
      <Stage className={`flex flex-col gap-5 lg:col-span-5 ${flip ? "lg:order-2" : ""}`}>
        <m.p variants={rise} className="flex items-center gap-2 font-mono text-small tracking-wide text-accent uppercase">
          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
          {feature.label}
        </m.p>
        <m.h3
          variants={rise}
          id={`start-f-${feature.id}`}
          className="text-[clamp(1.75rem,3.6vw,3rem)] leading-[1.02] font-black tracking-[-0.03em]"
        >
          {feature.title}
        </m.h3>
        <m.p variants={rise} className="max-w-[34rem] text-fg-muted">
          {feature.body}
        </m.p>
        {feature.notice ? (
          <m.p variants={rise} className="max-w-[34rem] border-l-2 border-warning pl-4 text-small text-fg">
            <strong className="font-bold">Aviso:</strong> {feature.notice}
          </m.p>
        ) : null}
        <m.ul variants={rise} className="flex flex-wrap gap-2">
          {feature.tags.map((t) => (
            <li key={t} className="border border-border-strong px-2 py-0.5 font-mono text-[0.75rem] text-fg-muted rounded-control">
              {t}
            </li>
          ))}
        </m.ul>
      </Stage>
      <div className={`min-w-0 lg:col-span-7 ${flip ? "lg:order-1" : ""}`}>
        <Frame path={feature.path}>
          <Mock />
        </Frame>
      </div>
    </article>
  );
}

export function Features() {
  return (
    <section id="dentro" aria-labelledby="start-dentro" className="mx-auto w-full max-w-[1600px] px-4 pt-24 sm:px-8 sm:pt-32">
      <Stage className="flex flex-col gap-6 pb-16 sm:pb-24">
        <m.h2 variants={rise} id="start-dentro" className="text-[clamp(3rem,10vw,9rem)] leading-[0.85] font-black tracking-[-0.045em]">
          Qué hay dentro
        </m.h2>
        <m.p variants={rise} className="max-w-[40rem] text-[1.125rem] text-fg-muted">
          Un foro de verdad y las herramientas on-chain que usas a diario, en el mismo sitio y en la misma red.
        </m.p>
      </Stage>
      {FEATURES.map((f, i) => (
        <FeatureRow key={f.id} feature={f} flip={i % 2 === 1} />
      ))}
    </section>
  );
}
