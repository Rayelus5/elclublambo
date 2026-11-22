import { TICK_HZ } from '@galaxy/sim';

// Loose items that expire (the owner, 2026-11-22; DESIGN_SYSTEM §8 quater): a data fragment or a repair kit about to go
// warns before it does. In its last `fadeSeconds` it blinks softly, faster and faster, while it fades; with reduced
// motion it only fades. The blink runs on the run's own time since the warning began (not the wall clock), so it starts
// whole, quickens smoothly and freezes with the world under a level-up card.

/**
 * How opaque a pickup is drawn with `left` ticks to go before it expires (Infinity: it never does; a fraction between
 * two ticks) and `fade` ticks of warning.
 */
export function pickupAlpha(left: number, fade: number, reduced: boolean): number {
  if (fade <= 0 || !(left < fade)) return 1;
  const k = Math.min(1, Math.max(0, left / fade));
  if (reduced) return 0.25 + 0.75 * k;
  const t = (fade - Math.max(0, left)) / TICK_HZ;
  const span = fade / TICK_HZ;
  // The blink's speed goes from 5 to 17 radians a second over the warning; its phase is that speed's integral.
  const phase = 5 * t + (6 * t * t) / span;
  return (0.35 + 0.65 * k) * (0.6 + 0.4 * Math.cos(phase));
}
