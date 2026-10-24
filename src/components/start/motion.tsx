"use client";

import { createContext, useContext, useRef, useSyncExternalStore, type ReactNode } from "react";
import { LazyMotion, m, useInView, useReducedMotion, type Variants } from "motion/react";

/*
 * Motion primitives of the /start landing.
 *
 * The rule: the server HTML (and any visitor without JS or with `prefers-reduced-motion`) gets the final, static page.
 * Motion only takes over after hydration and only when the visitor accepts motion; every animated element rests in its
 * identity state (opacity 1, no transform), so nothing is ever left hidden or displaced when motion is off.
 */

const noop = () => () => {};

/** True once hydrated and only when the visitor has not asked for reduced motion. */
export function useMotionOn(): boolean {
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const reduce = useReducedMotion();
  return hydrated && reduce === false;
}

/** Motion features load in their own chunk, after the page has painted. */
const loadFeatures = () => import("./motion-features").then((mod) => mod.default);

export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  );
}

export const EASE_OUT = [0.2, 0, 0, 1] as const;

/** A child of a staged block: rises into place. Its final state is the identity. */
export const rise: Variants = {
  hide: { opacity: 0, y: 24, transition: { duration: 0 } },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } },
};

/** Slides in from the right (tips, notifications). */
export const slide: Variants = {
  hide: { opacity: 0, x: 48, transition: { duration: 0 } },
  show: { opacity: 1, x: 0, transition: { duration: 0.6, ease: EASE_OUT } },
};

/** Grows from its left edge (bars, meters); pair with `origin-left`. */
export const grow: Variants = {
  hide: { scaleX: 0, transition: { duration: 0 } },
  show: { scaleX: 1, transition: { duration: 0.9, ease: EASE_OUT } },
};

/** Pops in (badges, seals). */
export const pop: Variants = {
  hide: { opacity: 0, scale: 0.6, transition: { duration: 0 } },
  show: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 380, damping: 18 } },
};

/** Draws an SVG stroke. */
export const draw: Variants = {
  hide: { pathLength: 0, transition: { duration: 0 } },
  show: { pathLength: 1, transition: { duration: 1.4, ease: EASE_OUT } },
};

const stagger = (gap: number, delay = 0.1): Variants => ({
  hide: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

const StageContext = createContext(true);

/** Whether the enclosing <Stage> is showing its final state. */
export const useStageShown = () => useContext(StageContext);

/**
 * A block whose `m.*` children (with the variants above) play once it scrolls into view. With motion off it renders its
 * final state from the start: `initial={false}` means no entry animation, just the "show" values (all identities).
 */
export function Stage({
  children,
  className,
  gap = 0.08,
  amount = 0.35,
  as = "div",
  label,
}: {
  children: ReactNode;
  className?: string;
  gap?: number;
  amount?: number;
  as?: "div" | "ul" | "ol";
  /** Accessible name (a list of tiles, for instance). */
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const on = useMotionOn();
  const seen = useInView(ref, { once: true, amount });
  const shown = !on || seen;
  const Tag = m[as] as typeof m.div;
  return (
    <StageContext.Provider value={shown}>
      <Tag ref={ref} aria-label={label} className={className} initial={false} animate={shown ? "show" : "hide"} variants={stagger(gap)}>
        {children}
      </Tag>
    </StageContext.Provider>
  );
}
