import { type Content, type ProbeDef, STAT_KEYS, type StatBonus, type WeaponDef } from '@galaxy/sim';
import type { ProbeVariantCard } from '../api/runs';
import type { ProbesConfig } from './unlocks';

// Probe levels and starting-weapon variants (GDD §6, M4b-1). Each level above 1 adds `perLevel` to its stats, bought
// with components and coins (`costs[i]` reaches level i + 2); the weapon's variants open at their `unlockAt` level.
// The numbers are live config (`probes.levels`); the variants are content (`variant` on a weapon).

export function probeMaxLevel(cfg: ProbesConfig): number {
  return cfg.levels.costs.length + 1;
}

/** The stat bonuses of a level (none at 1), clamped to 1…max. */
export function probeLevelBonuses(level: number, cfg: ProbesConfig): StatBonus[] {
  const l = Math.max(1, Math.min(probeMaxLevel(cfg), Math.floor(level) || 1));
  if (l === 1) return [];
  const out: StatBonus[] = [];
  for (const stat of STAT_KEYS) {
    const per = cfg.levels.perLevel[stat];
    if (per !== undefined && per > 0) out.push({ stat, value: per * (l - 1) });
  }
  return out;
}

/** What reaching the next level costs, or null at the top. */
export function probeLevelNext(level: number, cfg: ProbesConfig): { components: number; coins: number } | null {
  const cost = cfg.levels.costs[Math.max(1, Math.floor(level)) - 1];
  return cost && level < probeMaxLevel(cfg) ? { components: cost.components, coins: cost.coins } : null;
}

/** A weapon's variants, by the level that opens them. */
export function variantsOf(weaponId: string, content: Content): WeaponDef[] {
  return content.weapons.filter((w) => w.variant?.of === weaponId).sort((a, b) => a.variant!.unlockAt - b.variant!.unlockAt);
}

/** The weapon a probe starts with: the chosen variant if it is of its weapon and its level opens it, else the base. */
export function startingWeapon(probe: ProbeDef, level: number, chosen: string | null, content: Content): string {
  const v = chosen ? content.weapons.find((w) => w.id === chosen) : undefined;
  return v?.variant && v.variant.of === probe.weapon && level >= v.variant.unlockAt ? v.id : probe.weapon;
}

/** The Hangar's starting-weapon cards: the base first, then its variants, open or not at this level. */
export function probeVariantCards(probe: ProbeDef, level: number, content: Content): ProbeVariantCard[] {
  const base = content.weapons.find((w) => w.id === probe.weapon);
  return [...(base ? [base] : []), ...variantsOf(probe.weapon, content)].map((w) => {
    const unlockAt = w.variant?.unlockAt ?? 1;
    return { id: w.id, name: w.name, description: w.description, icon: w.icon, unlockAt, unlocked: level >= unlockAt, element: w.element ?? null };
  });
}
