import { type StatKey, STAT_KEYS } from '../content/types';
import { diminish } from '../math/stack';
import type { ProbeState, Sim, Stats } from '../types';
import { quirkSpeed } from './quirks';

// Probe stats (GDD §8.6): every source adds to its category; each category has diminishing returns and a cap
// (content.caps). Projectiles, pierce and regeneration have hard caps instead (a plain sum, clipped).

export type StatBonus = { stat: StatKey; value: number };

/** Bonuses from equipped relics (lens, scout, backgrounds…); filled in by systems/relics.ts. */
export const relicHooks: { bonuses: (sim: Sim, probe: ProbeState) => StatBonus[] } = { bonuses: () => [] };

function contributions(sim: Sim, p: ProbeState): Record<StatKey, number[]> {
  const c = Object.fromEntries(STAT_KEYS.map((k) => [k, [] as number[]])) as Record<StatKey, number[]>;
  for (const k of STAT_KEYS) {
    const v = p.def.bonus[k];
    if (v !== undefined) c[k].push(v);
  }
  for (const owned of p.passives) {
    const def = sim.content.passives.find((x) => x.id === owned.id);
    if (!def) continue;
    const v = def.levels[Math.min(owned.level, def.levels.length) - 1];
    if (v !== undefined) c[def.stat].push(v);
  }
  for (const b of relicHooks.bonuses(sim, p)) c[b.stat].push(b.value);
  for (const b of p.upgrades) c[b.stat].push(b.value);
  const burn = quirkSpeed(p);
  if (burn > 0) c.speed.push(burn);
  return c;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export function deriveStats(sim: Sim, p: ProbeState): Stats {
  const caps = sim.content.caps;
  const c = contributions(sim, p);
  const d = (k: StatKey) => diminish(c[k], caps[k]);
  return {
    maxHp: p.def.hp * (1 + d('maxHp')),
    speed: p.def.speed * (1 + d('speed')),
    cooldown: 1 - d('cooldown'),
    damage: 1 + d('damage'),
    area: 1 + d('area'),
    pickup: p.def.pickup * (1 + d('pickup')),
    projectiles: Math.floor(Math.min(Math.max(sum(c.projectiles), 0), caps.projectiles)),
    regen: Math.min(Math.max(p.def.regen + sum(c.regen), 0), caps.regen),
    armor: diminish([p.def.armor, ...c.armor], caps.armor),
    crit: diminish([sim.content.crit.chance, ...c.crit], caps.crit),
    critDamage: sim.content.crit.damage + d('critDamage'),
    xp: 1 + d('xp'),
    luck: 1 + d('luck'),
    lifesteal: d('lifesteal'),
    velocity: 1 + d('velocity'),
    duration: 1 + d('duration'),
    pierce: Math.floor(Math.min(Math.max(sum(c.pierce), 0), caps.pierce)),
    elemental: 1 + d('elemental'),
    barrier: d('barrier'),
    curse: d('curse'),
    evasion: d('evasion'),
    bossDamage: d('bossDamage'),
    execute: d('execute'),
    knockback: d('knockback'),
    movingDamage: d('movingDamage'),
  };
}

/** Recomputes a probe's stats; a higher max life raises current life by the same amount. */
export function refreshStats(sim: Sim, p: ProbeState): void {
  const before = p.stats.maxHp;
  p.stats = deriveStats(sim, p);
  if (p.stats.maxHp > before) p.hp += p.stats.maxHp - before;
  if (p.hp > p.stats.maxHp) p.hp = p.stats.maxHp;
}
