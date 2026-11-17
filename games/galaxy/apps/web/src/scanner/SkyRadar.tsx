import { TIERS, type Tier } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import { copy } from '../copy/es';

// «Cielo vivo» (2026-11-17, the owner: the deep scanner's screen was a big empty monitor): the monitor shows the sky
// being swept. A starfield drifts, a radar sweeps it every few seconds and its blips light up as the sweep passes, each
// in its tier's colour and as many of each as the next scan's odds say (the rarest always there, so there is something
// to chase). Faster while a scan is out. With reduced motion everything stands still. Decorative: the odds are in the
// table beside it.

export const BLIPS = 12;
export const SWEEP_S = 4;

/** The tier of each blip: the odds spread over the blips (largest remainders), with at least one legendary or better. */
export function blipTiers(rates: readonly number[]): Tier[] {
  const exact = TIERS.map((_, i) => (rates[i] ?? 0) * BLIPS);
  const counts = exact.map(Math.floor);
  let left = BLIPS - counts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    counts[i]!++;
    left--;
  }
  const legendary = TIERS.indexOf('legendary');
  if (counts[legendary]! + counts[TIERS.indexOf('mythic')]! === 0) {
    const from = counts.findIndex((c) => c > 0);
    counts[from]!--;
    counts[legendary]!++;
  }
  // The rarest first: they take the outer, more visible places.
  return TIERS.flatMap((t, i) => Array.from({ length: counts[i]! }, () => t)).reverse();
}

/** Where blip `i` sits: a golden-angle spread (angle clockwise from the top, distance from the centre 0..1). */
function place(i: number): { angle: number; dist: number } {
  return { angle: (i * 137.508) % 360, dist: 0.32 + 0.6 * ((i * 0.618034 + 0.2) % 1) };
}

export function SkyRadar({ rates, busy, event = false }: { rates: readonly number[]; busy: boolean; event?: boolean }) {
  const tiers = blipTiers(rates);
  return (
    <div className="sky" data-busy={busy || undefined} data-event={event || undefined}>
      <span className="sky-stars" />
      <span className="sky-stars far" />
      <div className="radar">
        <span className="radar-rings" />
        <span className="radar-sweep" />
        {tiers.map((tier, i) => {
          const { angle, dist } = place(i);
          const rad = (angle * Math.PI) / 180;
          const style = {
            left: `${50 + 46 * dist * Math.sin(rad)}%`,
            top: `${50 - 46 * dist * Math.cos(rad)}%`,
            // Lit when the sweep's edge passes its angle (a negative delay: no wait on the first turn).
            '--d': `${((angle / 360 - 1) * SWEEP_S).toFixed(2)}s`,
          } as CSSProperties;
          return <i key={i} className="radar-blip" data-tier={tier} style={style} />;
        })}
      </div>
      <span className="sky-hud">{event ? copy.scanner.sky.event : copy.scanner.sky.deep}</span>
      <span className="sky-ready">{busy ? copy.scanner.scanning : copy.scanner.ready}</span>
    </div>
  );
}
