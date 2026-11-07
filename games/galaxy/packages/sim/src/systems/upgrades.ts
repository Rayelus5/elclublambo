import type { Offer, ProbeState, Sim } from '../types';
import { refreshStats } from './stats';

// Level-up offers (GDD §5.1): 1 of 3 among new weapons (weight 1), weapon levels (1.2), new passives (1) and passive
// levels (1.2), never past content.limits or a max level. With nothing left to offer: a repair (30 % of max life).

const HEAL: Offer = { kind: 'heal', id: 'heal', level: 0 };
const HEAL_SHARE = 0.3;

export function offerFor(sim: Sim, p: ProbeState): Offer[] {
  const { weapons, passives, limits } = sim.content;
  const pool: { offer: Offer; weight: number }[] = [];
  for (const w of weapons) {
    const owned = p.weapons.find((x) => x.id === w.id);
    if (owned) {
      if (owned.level < w.levels.length) pool.push({ offer: { kind: 'weapon', id: w.id, level: owned.level + 1 }, weight: 1.2 });
    } else if (p.weapons.length < limits.weapons) {
      pool.push({ offer: { kind: 'weapon', id: w.id, level: 1 }, weight: 1 });
    }
  }
  for (const s of passives) {
    const owned = p.passives.find((x) => x.id === s.id);
    if (owned) {
      if (owned.level < s.levels.length) pool.push({ offer: { kind: 'passive', id: s.id, level: owned.level + 1 }, weight: 1.2 });
    } else if (p.passives.length < limits.passives) {
      pool.push({ offer: { kind: 'passive', id: s.id, level: 1 }, weight: 1 });
    }
  }
  if (pool.length === 0) return [HEAL];
  const out: Offer[] = [];
  while (out.length < 3 && pool.length > 0) {
    const total = pool.reduce((a, b) => a + b.weight, 0);
    let r = sim.rng.offer.float() * total;
    let i = 0;
    for (; i < pool.length - 1; i++) {
      r -= pool[i]!.weight;
      if (r < 0) break;
    }
    out.push(pool[i]!.offer);
    pool.splice(i, 1);
  }
  return out;
}

export function applyOffer(sim: Sim, p: ProbeState, offer: Offer): void {
  if (offer.kind === 'heal') {
    p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * HEAL_SHARE);
    return;
  }
  const list = offer.kind === 'weapon' ? p.weapons : p.passives;
  const owned = list.find((x) => x.id === offer.id);
  if (owned) owned.level = offer.level;
  else if (offer.kind === 'weapon') p.weapons.push({ id: offer.id, level: offer.level, t: 0 });
  else p.passives.push({ id: offer.id, level: offer.level });
  refreshStats(sim, p);
}
