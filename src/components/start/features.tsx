"use client";

import { clubPath } from "@/lib/club/paths";
import { useRef, type ComponentType, type ReactNode } from "react";
import { ChartCandlestick, Coins, Dices, Gavel, HandCoins, Landmark, MessagesSquare, Search, ShieldCheck, type LucideProps } from "lucide-react";
import { m, useScroll, useTransform } from "motion/react";
import type { StartDict } from "./dict";
import { AlphaMock, BountyMock, ChatMock, HomeMock, MarketMock, ModerationMock, RafflePollMock, TipsMock, TreasuryMock } from "./mocks";
import { rise, Stage, useMotionOn } from "./motion";

type Mocks = StartDict["mocks"];

type FeatureId = "inicio" | "chat" | "alphas" | "bounties" | "propinas" | "donaciones" | "sorteos" | "mercado" | "moderacion";

type Feature = {
  id: FeatureId;
  icon: ComponentType<LucideProps>;
  path: string;
  Mock: ComponentType<{ t: Mocks }>;
};

// Structure only: the copy of each one lives in the `start.features` dictionary.
const FEATURES: Feature[] = [
  { id: "inicio", icon: Search, path: clubPath(), Mock: HomeMock },
  { id: "chat", icon: MessagesSquare, path: clubPath("/c/trading"), Mock: ChatMock },
  { id: "alphas", icon: ShieldCheck, path: clubPath("/c/alphas"), Mock: AlphaMock },
  { id: "bounties", icon: HandCoins, path: clubPath("/c/bounties"), Mock: BountyMock },
  { id: "propinas", icon: Coins, path: clubPath("/u/marta"), Mock: TipsMock },
  { id: "donaciones", icon: Landmark, path: clubPath("/donar"), Mock: TreasuryMock },
  { id: "sorteos", icon: Dices, path: clubPath("/sorteos"), Mock: RafflePollMock },
  { id: "mercado", icon: ChartCandlestick, path: clubPath("/mercado"), Mock: MarketMock },
  { id: "moderacion", icon: Gavel, path: clubPath("/admin/roles"), Mock: ModerationMock },
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

function FeatureRow({ feature, flip, t }: { feature: Feature; flip: boolean; t: StartDict }) {
  const { icon: Icon, Mock } = feature;
  const copy = t.features[feature.id];
  return (
    <article aria-labelledby={`start-f-${feature.id}`} className="grid items-center gap-10 border-t border-border py-16 sm:py-24 lg:grid-cols-12 lg:gap-16">
      <Stage className={`flex flex-col gap-5 lg:col-span-5 ${flip ? "lg:order-2" : ""}`}>
        <m.p variants={rise} className="flex items-center gap-2 font-mono text-small tracking-wide text-accent uppercase">
          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
          {copy.label}
        </m.p>
        <m.h3
          variants={rise}
          id={`start-f-${feature.id}`}
          className="text-[clamp(1.75rem,3.6vw,3rem)] leading-[1.02] font-black tracking-[-0.03em]"
        >
          {copy.title}
        </m.h3>
        <m.p variants={rise} className="max-w-[34rem] text-fg-muted">
          {copy.body}
        </m.p>
        {feature.id === "donaciones" ? (
          <m.p variants={rise} className="max-w-[34rem] border-l-2 border-warning pl-4 text-small text-fg">
            <strong className="font-bold">{t.features.noticeLabel}</strong> {t.features.treasuryNotice}
          </m.p>
        ) : null}
        <m.ul variants={rise} className="flex flex-wrap gap-2">
          {copy.tags.map((tag) => (
            <li key={tag} className="border border-border-strong px-2 py-0.5 font-mono text-[0.75rem] text-fg-muted rounded-control">
              {tag}
            </li>
          ))}
        </m.ul>
      </Stage>
      <div className={`min-w-0 lg:col-span-7 ${flip ? "lg:order-1" : ""}`}>
        <Frame path={feature.path}>
          <Mock t={t.mocks} />
        </Frame>
      </div>
    </article>
  );
}

export function Features({ t }: { t: StartDict }) {
  return (
    <section id="dentro" aria-labelledby="start-dentro" className="mx-auto w-full max-w-[1600px] px-4 pt-24 sm:px-8 sm:pt-32">
      <Stage className="flex flex-col gap-6 pb-16 sm:pb-24">
        <m.h2 variants={rise} id="start-dentro" className="text-[clamp(3rem,10vw,9rem)] leading-[0.85] font-black tracking-[-0.045em]">
          {t.features.title}
        </m.h2>
        <m.p variants={rise} className="max-w-[40rem] text-[1.125rem] text-fg-muted">
          {t.features.lead}
        </m.p>
      </Stage>
      {FEATURES.map((f, i) => (
        <FeatureRow key={f.id} feature={f} flip={i % 2 === 1} t={t} />
      ))}
    </section>
  );
}
