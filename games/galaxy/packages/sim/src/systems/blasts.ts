import type { Sim } from '../types';
import { hurtProbe, PROBE_RADIUS } from './probes';

// Warned blasts (GDD §5.5, a Core's mines): laid with a circle on the ground, they go off on their tick and hurt the
// probes inside their radius. Nothing else touches them, so the order they were laid is the order they go off.

export function updateBlasts(sim: Sim): void {
  if (sim.blasts.length === 0) return;
  const left = [];
  for (const b of sim.blasts) {
    if (b.at > sim.tick) {
      left.push(b);
      continue;
    }
    for (const p of sim.probes) {
      if (!p.alive) continue;
      const r = b.radius + PROBE_RADIUS;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      if (dx * dx + dy * dy <= r * r) hurtProbe(sim, p, b.damage);
    }
    sim.events.push({ t: 'blast', x: b.x, y: b.y, radius: b.radius });
  }
  sim.blasts = left;
}
