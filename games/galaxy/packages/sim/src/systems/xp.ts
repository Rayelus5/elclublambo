import type { ProbeState, Sim } from '../types';

/** Data fragments needed to go from level `l` to the next: base + linear·l + ⌊quad·l²⌋ (11, 19, 27… by default). */
export function xpFor(sim: Sim, level: number): number {
  const { base, linear, quad } = sim.content.xp;
  return base + linear * level + Math.floor(quad * level * level);
}

/** Adds fragments; every level reached queues one choice. */
export function gainXp(sim: Sim, p: ProbeState, value: number): void {
  if (!p.alive) return;
  p.xp += value;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.pendingLevels++;
    p.xpNext = xpFor(sim, p.level);
    sim.events.push({ t: 'levelUp', probe: p.index, level: p.level });
  }
}
