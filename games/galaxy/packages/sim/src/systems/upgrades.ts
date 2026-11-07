import type { Content, WeaponDef } from '../content/types';
import type { Offer, ProbeState, Sim } from '../types';
import { relicElement } from './elements';
import { refreshStats } from './stats';
import { persistentFor } from './weapons';

// Level-up offers (GDD §5.1): 1 of 3 among new weapons (weight 1), weapon levels (1.2), new passives (1) and passive
// levels (1.2), never past content.limits or a max level. With nothing left to offer: a repair (30 % of max life).
// An evolution that is ready (GDD §5.3) always comes first; evolutions are never offered as new weapons, and a base
// weapon that evolved is not offered again.

const HEAL: Offer = { kind: 'heal', id: 'heal', level: 0 };
const HEAL_SHARE = 0.3;

/** The base of a starting-weapon variant, or the weapon itself (evolutions and offers treat a variant as its base). */
export function baseOf(content: Content, weaponId: string): string {
  return content.weapons.find((w) => w.id === weaponId)?.variant?.of ?? weaponId;
}

/** The evolutions this probe can take now: base at its max level, requirement met, not taken yet (content order). */
export function evolutionsFor(sim: Sim, p: ProbeState): WeaponDef[] {
  const out: WeaponDef[] = [];
  for (const evo of sim.content.weapons) {
    const e = evo.evolution;
    if (!e || p.weapons.some((w) => w.id === evo.id)) continue;
    const base = p.weapons.find((w) => baseOf(sim.content, w.id) === e.from);
    const baseDef = base && sim.content.weapons.find((w) => w.id === base.id);
    if (!base || !baseDef || base.level < baseDef.levels.length) continue;
    const req = e.requires;
    const met =
      'passive' in req ? p.passives.some((s) => s.id === req.passive) : p.relics.some((r) => relicElement(sim, r.traits) === req.element);
    if (met) out.push(evo);
  }
  return out;
}

/** Base weapons whose evolution this probe already has. */
function evolvedBases(sim: Sim, p: ProbeState): Set<string> {
  const out = new Set<string>();
  for (const w of p.weapons) {
    const from = sim.content.weapons.find((d) => d.id === w.id)?.evolution?.from;
    if (from) out.add(from);
  }
  return out;
}

export function offerFor(sim: Sim, p: ProbeState): Offer[] {
  const { weapons, passives, limits } = sim.content;
  const pool: { offer: Offer; weight: number }[] = [];
  const evolved = evolvedBases(sim, p);
  // A variant is only levelled up, never offered new; a base is not offered new beside its own variant.
  const bases = new Set(p.weapons.map((x) => baseOf(sim.content, x.id)));
  for (const w of weapons) {
    if (w.evolution || evolved.has(w.id)) continue;
    const owned = p.weapons.find((x) => x.id === w.id);
    if (!owned && (w.variant || bases.has(w.id))) continue;
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
  const ready = evolutionsFor(sim, p)[0];
  const out: Offer[] = ready ? [{ kind: 'evolve', id: ready.id, level: 1 }] : [];
  if (pool.length === 0 && out.length === 0) return [HEAL];
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
  if (offer.kind === 'evolve') {
    const from = sim.content.weapons.find((w) => w.id === offer.id)?.evolution?.from;
    const wi = p.weapons.findIndex((w) => baseOf(sim.content, w.id) === from);
    if (!from || wi < 0) return;
    // The slot's persistent shots (orbs, drones, beams, turrets…) are rebuilt once for the evolved weapon.
    for (const i of persistentFor(sim, p, wi)) sim.shots.kill(i);
    p.weapons[wi] = { id: offer.id, level: 1, t: 0 };
    sim.events.push({ t: 'evolve', probe: p.index, from, to: offer.id });
    refreshStats(sim, p);
    return;
  }
  const list = offer.kind === 'weapon' ? p.weapons : p.passives;
  const owned = list.find((x) => x.id === offer.id);
  if (owned) owned.level = offer.level;
  else if (offer.kind === 'weapon') p.weapons.push({ id: offer.id, level: offer.level, t: 0 });
  else p.passives.push({ id: offer.id, level: offer.level });
  refreshStats(sim, p);
}
