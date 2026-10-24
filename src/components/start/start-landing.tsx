"use client";

import { m, useScroll, useSpring } from "motion/react";
import type { Lang } from "@/lib/i18n/config";
import type { StartDict } from "./dict";
import { Features } from "./features";
import { DonationsNote, FinalCta } from "./final-cta";
import { Hero } from "./hero";
import { HowToJoin } from "./how-to-join";
import { MotionRoot, useMotionOn } from "./motion";
import { NoiseToSignal } from "./noise-to-signal";
import { OpenTools } from "./open-tools";
import { TrustChain } from "./trust-chain";

/** Thin cyan line on top: how far along the page you are. Only with motion. */
function ScrollProgress() {
  const on = useMotionOn();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 40, restDelta: 0.001 });
  if (!on) return null;
  return <m.div aria-hidden style={{ scaleX }} className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-accent" />;
}

/** The public landing (/start, /en/start): what ElClub. is, for whoever has no invitation yet. The shared PublicFooter closes the page. */
export function StartLanding({ lang, t }: { lang: Lang; t: StartDict }) {
  return (
    <MotionRoot>
      <ScrollProgress />
      <main className="flex-1 overflow-x-clip">
        <Hero t={t} />
        <NoiseToSignal t={t} />
        <Features t={t} />
        <TrustChain t={t} />
        <HowToJoin t={t} />
        <OpenTools t={t} lang={lang} />
        <FinalCta t={t} />
      </main>
      <DonationsNote t={t} />
    </MotionRoot>
  );
}
