"use client";

import { m, useScroll, useSpring } from "motion/react";
import { Features } from "./features";
import { FinalCta, StartFooter } from "./final-cta";
import { Hero } from "./hero";
import { HowToJoin } from "./how-to-join";
import { MotionRoot, useMotionOn } from "./motion";
import { NoiseToSignal } from "./noise-to-signal";
import { TrustChain } from "./trust-chain";

/** Thin cyan line on top: how far along the page you are. Only with motion. */
function ScrollProgress() {
  const on = useMotionOn();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 40, restDelta: 0.001 });
  if (!on) return null;
  return <m.div aria-hidden style={{ scaleX }} className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-accent" />;
}

/** The public landing (/start): what ElClub. is, for whoever has no invitation yet. */
export function StartLanding() {
  return (
    <MotionRoot>
      <ScrollProgress />
      <main className="flex-1 overflow-x-clip">
        <Hero />
        <NoiseToSignal />
        <Features />
        <TrustChain />
        <HowToJoin />
        <FinalCta />
      </main>
      <StartFooter />
    </MotionRoot>
  );
}
