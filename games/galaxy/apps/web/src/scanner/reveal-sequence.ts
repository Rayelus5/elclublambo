import { atLeast, TIERS, type PulledGalaxy, type Tier } from '@galaxy/shared';

// The deep-field scan (GDD §9, DESIGN_SYSTEM §8 bis) as a pure list of timed steps, so the rhythm is tested and the
// stage only plays it. Per pull: CRT static → signal bars (one per tier step) → the scan line in the rarity's colour
// resolving the galaxy → «Fenómeno detectado» if it has one → the screen failing on a Legendary (or a Mítica, which
// also lights a sixth bar past the five) → the card. The
// sequence always ends in the summary, which Saltar jumps to. Rarer pulls build up longer, so the wait tells too.
export type StepKind = 'static' | 'signal' | 'scan' | 'phenomenon' | 'glitch' | 'card' | 'summary';

export interface Step {
  kind: StepKind;
  /** The pull this step belongs to (the summary: -1). */
  index: number;
  tier?: Tier;
  /** Signal bars lit (1 common → 5 legendary, 6 mythic: one past the five). */
  bars?: number;
  phenomenon?: string;
  /** How long the step lasts; Infinity waits for the player. */
  ms: number;
}

/** Luminance jolts in one screen failure: two in 900 ms stays well under three flashes per second (WCAG 2.3.1). */
export const GLITCH_FLASHES = 2;
const GLITCH_MS = 900;

const STATIC_FIRST = 900;
const STATIC_NEXT = 200;
const STATIC_REDUCED = 250;
// A single pull builds up slowly; in a run of ten (open beta) each step is shorter, the commons above all.
const signalMs = (t: number, inRun: boolean) => (inRun ? 360 + 140 * t : 520 + 170 * t);
const scanMs = (t: number, reduced: boolean, inRun: boolean) => (reduced ? 500 : inRun ? 620 + 300 * t : 1000 + 320 * t);
const PHENOMENON_MS = 1300;
/** How long a card stays in a run of ten, by tier: the rare ones are looked at longer. */
const CARD_IN_RUN_MS = [900, 1100, 1500, 1900, 2400, 2800];

export function revealSequence(pulls: readonly PulledGalaxy[], opts: { reduced: boolean }): Step[] {
  const steps: Step[] = [];
  const inRun = pulls.length > 1;
  pulls.forEach((p, index) => {
    const t = TIERS.indexOf(p.tier);
    const staticMs = opts.reduced ? STATIC_REDUCED : index === 0 ? STATIC_FIRST : STATIC_NEXT;
    steps.push({ kind: 'static', index, ms: staticMs });
    steps.push({ kind: 'signal', index, tier: p.tier, bars: t + 1, ms: signalMs(t, inRun) });
    steps.push({ kind: 'scan', index, tier: p.tier, ms: scanMs(t, opts.reduced, inRun) });
    const phenomenon = p.traits['phenomenon'];
    if (phenomenon && phenomenon !== 'none') steps.push({ kind: 'phenomenon', index, tier: p.tier, phenomenon, ms: PHENOMENON_MS });
    if (atLeast(p.tier, 'legendary') && !opts.reduced) steps.push({ kind: 'glitch', index, tier: p.tier, ms: GLITCH_MS });
    // One pull, or reduced motion: the card waits for the player. In a run of ten, cards follow on their own.
    const waits = pulls.length === 1 || opts.reduced;
    steps.push({ kind: 'card', index, tier: p.tier, ms: waits ? Infinity : (CARD_IN_RUN_MS[t] ?? CARD_IN_RUN_MS[0]!) });
  });
  steps.push({ kind: 'summary', index: -1, ms: Infinity });
  return steps;
}

export function skipToSummary(steps: readonly Step[]): number {
  return steps.length - 1;
}

/** Where a tap leads: from inside a pull to its card; from a card to the next pull (or the summary). */
export function advance(steps: readonly Step[], at: number): number {
  const step = steps[at];
  if (!step || step.kind === 'summary') return at;
  if (step.kind !== 'card') {
    const card = steps.findIndex((s, i) => i > at && s.kind === 'card' && s.index === step.index);
    return card >= 0 ? card : at + 1;
  }
  return at + 1;
}
