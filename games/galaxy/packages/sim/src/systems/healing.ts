import type { ProbeState, Sim } from '../types';
import { ticks } from '../version';

// Healing (Sifón rework, 2026-11-16). Every heal of a probe goes through `healProbe`:
// - life stolen from enemies ('steal': Sifón's lifesteal, the leech element, the drain reaction) comes out of a budget
//   a second, maxHp × (base + perLifesteal × lifesteal), banked up to `burst` seconds: no build out-heals the hits it
//   takes any more (each one at most `hitCap` of the life, one every 0,5 s);
// - nothing heals while the Static has caught the probe (stillness.ts): not the steal, regeneration, kits or the card.
// Overflow at full life costs nothing from the budget.

export function healBudget(sim: Sim, p: ProbeState): number {
  const h = sim.content.healing;
  return p.stats.maxHp * (h.base + h.perLifesteal * p.stats.lifesteal);
}

/** The Static has caught it: it is hurting the probe, and blocks every heal until it leaves the area. */
export function healBlocked(sim: Sim, p: ProbeState): boolean {
  const s = sim.content.stillness;
  return s.hurt > 0 && p.still.t >= ticks(s.hurt);
}

/** Heals `amount` (within the budget for 'steal'); returns what it really healed. */
export function healProbe(sim: Sim, p: ProbeState, amount: number, kind: 'steal' | 'other'): number {
  if (!p.alive || !(amount > 0) || healBlocked(sim, p)) return 0;
  let give = Math.min(amount, p.stats.maxHp - p.hp);
  if (kind === 'steal') give = Math.min(give, p.healBank);
  if (give <= 0) return 0;
  if (kind === 'steal') p.healBank -= give;
  p.hp += give;
  return give;
}

/** One tick of the budget refilling. */
export function refillHealBank(sim: Sim, p: ProbeState): void {
  const b = healBudget(sim, p);
  p.healBank = Math.min(b * sim.content.healing.burst, p.healBank + b / 60);
}
