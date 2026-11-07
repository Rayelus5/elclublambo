import { type Content, type ElementId, type FamilyId, PHENOMENON_IDS, type PhenomenonId, type StatKey } from '../content/types';
import { diminish } from '../math/stack';
import { angleTo, ANGLE_STEPS, cosA, degToSteps, sinA } from '../math/trig';
import type { HitSource, ProbeState, RelicInput, Sim } from '../types';
import { ticks } from '../version';
import { dealDamage } from './combat';
import { elementCode, invertNearby } from './elements';
import { refreshStats, relicHooks, type StatBonus } from './stats';
import { AREA, hitArea, keepRing, lastHit, nearestEnemies, remember, SHOT, shotHooks, spawnArea, spawnShot } from './weapons';

// Galaxies as relics (GDD §8.2–8.4 bis, §8.6). The galaxy type picks the family; arms give the count; rarity, size,
// core and level give the magnitude; density the frequency; inclination the shape; palette the element; background a
// bonus; phenomenon a unique ability. Everything a relic does in the run lives here.

export interface RelicSkill {
  family: FamilyId;
  /** Merger relics (echo): the family they copy, at `share` of their magnitude. */
  copies: FamilyId | null;
  share: number;
  element: ElementId | null;
  phenomenon: PhenomenonId | null;
  magnitude: number;
  frequency: number;
  count: number;
  shape: 'circle' | 'cone' | 'line';
  quasar: boolean;
  double: boolean;
  background: { stat: StatKey | 'vision'; value: number } | null;
}

const TYPE_FAMILY: Record<string, FamilyId> = {
  spiral: 'blades',
  barred_spiral: 'ray',
  elliptical: 'shield',
  lenticular: 'lens',
  irregular: 'chaos',
  ring: 'aura',
  dwarf: 'scout',
  merger: 'echo',
};

const SHAPE: Record<string, RelicSkill['shape']> = { face_on: 'circle', tilted: 'cone', edge_on: 'line' };

function baseFamily(traits: Record<string, string>): FamilyId {
  return TYPE_FAMILY[traits['galaxy_type'] ?? ''] ?? 'chaos';
}

/** What a relic does, from its traits, rarity and level (pure; also what the Hangar describes). */
export function relicSkill(relic: RelicInput, all: readonly RelicInput[], content: Content): RelicSkill {
  const t = relic.traits;
  const R = content.relics;
  const family = baseFamily(t);
  const arms = Number.parseInt(t['arms'] ?? '', 10);
  const level = Math.max(1, Math.min(10, Math.floor(relic.level) || 1));
  const levelBonus = diminish(Array.from({ length: level - 1 }, () => R.level.step), R.level.cap);
  const magnitude = (R.tier[relic.tier] ?? 1) * (R.size[t['size'] ?? ''] ?? 1) * (R.core[t['core'] ?? ''] ?? 1) * (1 + levelBonus);
  let copies: FamilyId | null = null;
  if (family === 'echo') {
    const me = Math.max(0, all.indexOf(relic));
    copies = 'chaos';
    for (let k = 1; k < all.length; k++) {
      const other = baseFamily(all[(me + k) % all.length]!.traits);
      if (other !== 'echo') {
        copies = other;
        break;
      }
    }
  }
  const phenomenon = (PHENOMENON_IDS as readonly string[]).includes(t['phenomenon'] ?? '') ? (t['phenomenon'] as PhenomenonId) : null;
  return {
    family,
    copies,
    share: family === 'echo' ? R.families.echo.share : 1,
    element: content.elements.palettes[t['palette'] ?? ''] ?? null,
    phenomenon,
    magnitude,
    frequency: R.density[t['star_density'] ?? ''] ?? 1,
    count: (family === 'blades' || family === 'ray') && arms > 0 ? arms : 1,
    shape: SHAPE[t['inclination'] ?? ''] ?? 'circle',
    quasar: t['core'] === 'quasar',
    double: t['core'] === 'double_nucleus',
    background: R.backgrounds[t['background'] ?? ''] ?? null,
  };
}

/** Same as relicSkill, named for the Hangar's description of a relic. */
export const describeRelic = relicSkill;

/** Radii grow more gently than damage: half of the magnitude above 1. */
function radiusScale(m: number): number {
  return 1 + (m - 1) * 0.5;
}

interface Runtime {
  skill: RelicSkill;
  famT: number;
  phenT: number;
  quasarT: number;
  again: number;
  aura: number;
  auraGen: number;
}

const runtimes = new WeakMap<ProbeState, Runtime[]>();
const dashHits = new WeakMap<ProbeState, Set<number>>();

function skillsOf(sim: Sim, p: ProbeState): Runtime[] {
  let list = runtimes.get(p);
  if (!list) {
    list = p.relics.map((r) => ({ skill: relicSkill(r, p.relics, sim.content), famT: 0, phenT: 0, quasarT: 0, again: 0, aura: -1, auraGen: -1 }));
    runtimes.set(p, list);
  }
  return list;
}

function effective(r: Runtime): { family: FamilyId; m: number } {
  return r.skill.family === 'echo' ? { family: r.skill.copies ?? 'chaos', m: r.skill.magnitude * r.skill.share } : { family: r.skill.family, m: r.skill.magnitude };
}

function cooldown(p: ProbeState, r: Runtime, seconds: number): number {
  return Math.max(1, Math.round(((seconds * 60) / r.skill.frequency) * p.stats.cooldown));
}

function source(p: ProbeState, ri: number, r: Runtime): HitSource {
  return { probe: p.index, weapon: null, relic: ri, element: r.skill.element, x: p.x, y: p.y };
}

/** Stat bonuses of a probe's relics (lens, scout, backgrounds, Einstein ring, chaos haste). */
export function relicBonuses(sim: Sim, p: ProbeState): StatBonus[] {
  const F = sim.content.relics.families;
  const out: StatBonus[] = [];
  for (const r of skillsOf(sim, p)) {
    const { family, m } = effective(r);
    if (family === 'lens') out.push({ stat: 'crit', value: F.lens.crit * m }, { stat: 'critDamage', value: F.lens.critDamage * m });
    if (family === 'scout') out.push({ stat: 'pickup', value: F.scout.pickup * m }, { stat: 'speed', value: F.scout.speed * m });
    const bg = r.skill.background;
    if (bg && bg.stat !== 'vision') out.push({ stat: bg.stat, value: bg.value });
    if (r.skill.phenomenon === 'einstein_ring') out.push({ stat: 'projectiles', value: sim.content.relics.phenomena.einstein_ring.projectiles });
  }
  if ((p.fx['hasteT'] ?? 0) > 0) out.push({ stat: 'speed', value: F.chaos.haste.bonus });
  return out;
}

/** Camera bonus of the relics' backgrounds (starfield): the renderer shows that much more of the field. */
export function relicVision(sim: Sim, p: ProbeState): number {
  let v = 0;
  for (const r of skillsOf(sim, p)) if (r.skill.background?.stat === 'vision') v += r.skill.background.value;
  return v;
}

function keepShots(sim: Sim, p: ProbeState, ri: number, kind: number, count: number): void {
  const s = sim.shots;
  const mine: number[] = [];
  for (let i = 0; i < s.top; i++) if (s.alive[i] && s.kind[i] === kind && s.owner[i] === p.index && s.srcKind[i] === 1 && s.srcIdx[i] === ri) mine.push(i);
  const element = elementCode(skillsOf(sim, p)[ri]?.skill.element ?? null);
  keepRing(sim, mine, count, () => spawnShot(sim, p, kind, p.x, p.y, 0, 0, 0, { ttl: 1, srcKind: 1, srcIdx: ri, element }));
}

function fireRays(sim: Sim, p: ProbeState, ri: number, r: Runtime, m: number): void {
  const F = sim.content.relics.families.ray;
  const n = r.skill.count + p.stats.projectiles;
  const damage = F.damage * m * p.stats.damage;
  const ttl = Math.max(1, Math.ceil((F.range / Math.max(F.speed, 1)) * 60));
  const element = elementCode(r.skill.element);
  for (let k = 0; k < n; k++) {
    let a = p.aim;
    if (r.skill.shape === 'circle') a = p.aim + Math.round((k * ANGLE_STEPS) / n);
    else if (r.skill.shape === 'cone' && n > 1) a = p.aim + Math.round((k - (n - 1) / 2) * (degToSteps(F.cone) / (n - 1)));
    const pierce = r.skill.shape === 'line' ? 1_000_000 : F.pierce;
    spawnShot(sim, p, SHOT.ray, p.x, p.y, ((a % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS, F.speed, damage, { ttl, pierce, srcKind: 1, srcIdx: ri, element });
  }
  sim.events.push({ t: 'fire', weapon: 'relic:ray', x: p.x, y: p.y });
}

function doChaos(sim: Sim, p: ProbeState, ri: number, r: Runtime, m: number): void {
  const F = sim.content.relics.families.chaos;
  const rs = radiusScale(m) * p.stats.area;
  const element = elementCode(r.skill.element);
  switch (sim.rng.relic.int(4)) {
    case 0:
      hitArea(sim, p.x, p.y, F.nova.radius * rs, F.nova.damage * m * p.stats.damage, source(p, ri, r));
      spawnArea(sim, p, AREA.nova, p.x, p.y, F.nova.radius * rs, { ttl: 18, follow: true, srcKind: 1, srcIdx: ri, element });
      break;
    case 1:
      for (let k = 0; k < F.bolts.count; k++) {
        spawnShot(sim, p, SHOT.chaos, p.x, p.y, sim.rng.relic.int(ANGLE_STEPS), F.bolts.speed, F.bolts.damage * m * p.stats.damage, {
          ttl: Math.ceil((260 / Math.max(F.bolts.speed, 1)) * 60),
          srcKind: 1,
          srcIdx: ri,
          element,
        });
      }
      break;
    case 2:
      spawnArea(sim, p, AREA.slowField, p.x, p.y, F.slowField.radius * rs, { ttl: ticks(F.slowField.seconds), interval: 6, slow: 1, srcKind: 1, srcIdx: ri, element });
      break;
    default:
      p.fx['hasteT'] = ticks(F.haste.seconds);
      refreshStats(sim, p);
      break;
  }
  sim.events.push({ t: 'fire', weapon: 'relic:chaos', x: p.x, y: p.y });
}

function keepAura(sim: Sim, p: ProbeState, ri: number, r: Runtime, m: number): void {
  const F = sim.content.relics.families.aura;
  const a = sim.areas;
  const cone = r.skill.shape === 'cone';
  const radius = F.radius * radiusScale(m) * p.stats.area * (cone ? F.coneRadius : 1);
  if (r.aura < 0 || !a.alive[r.aura] || a.gen[r.aura] !== r.auraGen || a.kind[r.aura] !== AREA.aura) {
    r.aura = spawnArea(sim, p, AREA.aura, p.x, p.y, radius, {
      ttl: 2,
      damage: F.damage * m * p.stats.damage,
      interval: Math.max(1, Math.round((F.interval * 60) / r.skill.frequency)),
      follow: true,
      arc: cone ? degToSteps(F.cone) : 0,
      angle: p.facing,
      srcKind: 1,
      srcIdx: ri,
      element: elementCode(r.skill.element),
    });
    r.auraGen = r.aura >= 0 ? a.gen[r.aura]! : -1;
    return;
  }
  a.ttl[r.aura] = 2;
  a.radius[r.aura] = radius;
  a.damage[r.aura] = F.damage * m * p.stats.damage;
  a.angle[r.aura] = p.facing;
}

function runFamily(sim: Sim, p: ProbeState, ri: number, r: Runtime): void {
  const { family, m } = effective(r);
  const F = sim.content.relics.families;
  switch (family) {
    case 'blades':
      keepShots(sim, p, ri, SHOT.blade, r.skill.count);
      return;
    case 'shield': {
      const max = F.shield.shield * m;
      const key = 'shieldMax' + ri;
      // The capacity is registered once (and filled); recharging lives in systems/probes.ts with the barrier's.
      if (p.fx[key] === undefined) {
        p.fx[key] = max;
        p.shield += max;
      }
      return;
    }
    case 'aura':
      keepAura(sim, p, ri, r, m);
      return;
    case 'ray':
    case 'chaos': {
      const base = family === 'ray' ? F.ray.cooldown : F.chaos.cooldown;
      if (r.again > 0) {
        r.again--;
        if (r.again === 0) {
          if (family === 'ray') fireRays(sim, p, ri, r, m);
          else doChaos(sim, p, ri, r, m);
        }
      }
      if (r.famT > 0) r.famT--;
      if (r.famT > 0) return;
      if (family === 'ray') fireRays(sim, p, ri, r, m);
      else doChaos(sim, p, ri, r, m);
      r.famT = cooldown(p, r, base);
      if (r.skill.double) r.again = Math.max(1, ticks(sim.content.relics.double.delay));
      return;
    }
    default:
      return; // lens, scout: stats only
  }
}

function dashStep(sim: Sim, p: ProbeState, ri: number, r: Runtime, m: number): void {
  const C = sim.content.relics.phenomena.comet;
  const steps = Math.max(1, ticks(C.seconds));
  const per = C.distance / steps;
  p.x += cosA(p.facing) * per;
  p.y += sinA(p.facing) * per;
  const hit = dashHits.get(p) ?? new Set<number>();
  dashHits.set(p, hit);
  const en = sim.enemies;
  for (const e of nearestEnemies(sim, p.x, p.y, 12, 64)) {
    const key = e * 65536 + en.gen[e]!;
    if (hit.has(key)) continue;
    hit.add(key);
    dealDamage(sim, e, C.damage * m * p.stats.damage, source(p, ri, r));
  }
  p.fx['dashT'] = (p.fx['dashT'] ?? 0) - 1;
}

function runPhenomenon(sim: Sim, p: ProbeState, ri: number, r: Runtime): void {
  const ph = r.skill.phenomenon;
  if (!ph) return;
  const P = sim.content.relics.phenomena;
  const { m } = effective(r);
  const rs = radiusScale(m) * p.stats.area;
  const element = elementCode(r.skill.element);
  switch (ph) {
    case 'satellite_galaxy':
      keepShots(sim, p, ri, SHOT.drone, 1);
      return;
    case 'globular_cluster':
      keepShots(sim, p, ri, SHOT.orb, P.globular_cluster.count);
      return;
    case 'einstein_ring':
      return;
    case 'comet':
      if ((p.fx['dashT'] ?? 0) > 0 && p.fx['dashRelic'] === ri) {
        dashStep(sim, p, ri, r, m);
        return;
      }
      break;
    default:
      break;
  }
  if (r.phenT > 0) r.phenT--;
  if (r.phenT > 0) return;
  const src = source(p, ri, r);
  switch (ph) {
    case 'supernova':
      hitArea(sim, p.x, p.y, P.supernova.radius * rs, P.supernova.damage * m * p.stats.damage, src);
      spawnArea(sim, p, AREA.supernova, p.x, p.y, P.supernova.radius * rs, { ttl: 24, follow: true, srcKind: 1, srcIdx: ri, element });
      r.phenT = cooldown(p, r, P.supernova.cooldown);
      break;
    case 'comet':
      if (!p.moving) return;
      p.fx['dashT'] = Math.max(1, ticks(P.comet.seconds));
      p.fx['dashRelic'] = ri;
      p.invulnT = Math.max(p.invulnT, p.fx['dashT']! + 1);
      dashHits.set(p, new Set());
      dashStep(sim, p, ri, r, m);
      r.phenT = cooldown(p, r, P.comet.cooldown);
      break;
    case 'relativistic_jets': {
      const J = P.relativistic_jets;
      const ttl = Math.ceil((450 / Math.max(J.speed, 1)) * 60);
      for (const a of [p.aim, p.aim + ANGLE_STEPS / 2]) {
        spawnShot(sim, p, SHOT.jet, p.x, p.y, a % ANGLE_STEPS, J.speed, J.damage * m * p.stats.damage, { ttl, pierce: J.pierce, srcKind: 1, srcIdx: ri, element });
      }
      r.phenT = cooldown(p, r, J.cooldown);
      break;
    }
    case 'pulsar':
      hitArea(sim, p.x, p.y, P.pulsar.radius * rs, P.pulsar.damage * m * p.stats.damage, src);
      spawnArea(sim, p, AREA.pulsar, p.x, p.y, P.pulsar.radius * rs, { ttl: 16, follow: true, srcKind: 1, srcIdx: ri, element });
      r.phenT = cooldown(p, r, P.pulsar.cooldown);
      break;
    case 'anomaly':
      anomaly(sim, p, ri, r, m);
      r.phenT = cooldown(p, r, P.anomaly.cooldown);
      break;
    default:
      return;
  }
  sim.events.push({ t: 'fire', weapon: 'relic:' + ph, x: p.x, y: p.y });
}

function anomaly(sim: Sim, p: ProbeState, ri: number, r: Runtime, m: number): void {
  const A = sim.content.relics.phenomena.anomaly;
  const en = sim.enemies;
  switch (sim.rng.relic.int(3)) {
    case 0: {
      const [e] = nearestEnemies(sim, p.x, p.y, 600, 1);
      const away = e === undefined ? sim.rng.relic.int(ANGLE_STEPS) : angleTo(p.x - en.x[e]!, p.y - en.y[e]!);
      p.x += cosA(away) * A.blink;
      p.y += sinA(away) * A.blink;
      return;
    }
    case 1:
      for (const e of nearestEnemies(sim, p.x, p.y, A.freezeRadius, 400)) if (!en.boss[e]) en.freezeT[e] = ticks(A.freezeSeconds);
      return;
    default: {
      const pool = nearestEnemies(sim, p.x, p.y, sim.content.arena.viewH / 2, 400);
      for (let k = 0; k < A.strikeCount && pool.length > 0; k++) {
        const e = pool.splice(sim.rng.relic.int(pool.length), 1)[0]!;
        dealDamage(sim, e, A.strikeDamage * m * p.stats.damage, source(p, ri, r));
      }
    }
  }
}

function runQuasar(sim: Sim, p: ProbeState, ri: number, r: Runtime): void {
  if (r.quasarT > 0) r.quasarT--;
  if (r.quasarT > 0) return;
  const Q = sim.content.relics.quasar;
  const { m } = effective(r);
  spawnShot(sim, p, SHOT.quasar, p.x, p.y, p.aim, Q.speed, Q.damage * m * p.stats.damage, {
    ttl: Math.ceil((500 / Math.max(Q.speed, 1)) * 60),
    pierce: Q.pierce,
    srcKind: 1,
    srcIdx: ri,
    element: elementCode(r.skill.element),
  });
  r.quasarT = cooldown(p, r, Q.cooldown);
  sim.events.push({ t: 'fire', weapon: 'relic:quasar', x: p.x, y: p.y });
}

/** One tick of a probe's relics. */
export function updateRelics(sim: Sim, p: ProbeState): void {
  if (!p.alive) return;
  if ((p.fx['hasteT'] ?? 0) > 0) {
    p.fx['hasteT'] = p.fx['hasteT']! - 1;
    if (p.fx['hasteT'] === 0) refreshStats(sim, p);
  }
  let invert = false;
  skillsOf(sim, p).forEach((r, ri) => {
    runFamily(sim, p, ri, r);
    runPhenomenon(sim, p, ri, r);
    if (r.skill.quasar) runQuasar(sim, p, ri, r);
    if (r.skill.element === 'invert') invert = true;
  });
  if (invert) invertNearby(sim, p);
}

/** Relic shots that stay with their probe: blades, cluster orbs and the satellite drone. */
function relicPersistent(sim: Sim, i: number): boolean {
  const s = sim.shots;
  const kind = s.kind[i]!;
  if (s.srcKind[i] !== 1 || (kind !== SHOT.blade && kind !== SHOT.orb && kind !== SHOT.drone)) return false;
  const p = sim.probes[s.owner[i]!];
  const r = p ? skillsOf(sim, p)[s.srcIdx[i]!] : undefined;
  if (!p || !r) {
    s.kill(i);
    return true;
  }
  const { m } = effective(r);
  const P = sim.content.relics.phenomena;
  const F = sim.content.relics.families;
  if (kind === SHOT.drone) {
    const S = P.satellite_galaxy;
    s.reach[i] = (s.reach[i]! + 0.6) % ANGLE_STEPS;
    const a = Math.round(s.reach[i]!);
    s.x[i] = s.x[i]! + (p.x + cosA(a) * 30 - s.x[i]!) * 0.2;
    s.y[i] = s.y[i]! + (p.y + sinA(a) * 30 - s.y[i]!) * 0.2;
    if (!p.alive) return true;
    if (s.target[i]! > 0) s.target[i] = s.target[i]! - 1;
    if (s.target[i]! > 0) return true;
    const [e] = nearestEnemies(sim, s.x[i]!, s.y[i]!, S.range, 1);
    if (e === undefined) return true;
    spawnShot(sim, p, SHOT.droneBolt, s.x[i]!, s.y[i]!, angleTo(sim.enemies.x[e]! - s.x[i]!, sim.enemies.y[e]! - s.y[i]!), S.speed, S.damage * m * p.stats.damage, {
      ttl: Math.ceil(((S.range * 1.3) / Math.max(S.speed, 1)) * 60),
      srcKind: 1,
      srcIdx: s.srcIdx[i]!,
      element: s.element[i]!,
    });
    s.target[i] = cooldown(p, r, S.cooldown);
    return true;
  }
  const blade = kind === SHOT.blade;
  const radius = (blade ? F.blades.radius : P.globular_cluster.radius) * radiusScale(m) * p.stats.area;
  const speed = blade ? F.blades.speed : P.globular_cluster.speed;
  const interval = Math.max(1, Math.round((blade ? F.blades.interval : P.globular_cluster.interval) * 60));
  const damage = (blade ? F.blades.damage : P.globular_cluster.damage) * m * p.stats.damage;
  s.reach[i] = (s.reach[i]! + (speed * ANGLE_STEPS) / 360 / 60) % ANGLE_STEPS;
  const a = Math.round(s.reach[i]!);
  s.x[i] = p.x + cosA(a) * radius;
  s.y[i] = p.y + sinA(a) * radius;
  if (!p.alive) return true;
  for (const e of nearestEnemies(sim, s.x[i]!, s.y[i]!, s.radius[i]!, 16)) {
    const last = lastHit(sim, i, e);
    if (last >= 0 && sim.tick - last < interval) continue;
    remember(sim, i, e);
    dealDamage(sim, e, damage, { ...source(p, s.srcIdx[i]!, r), x: p.x, y: p.y });
  }
  return true;
}

// The relic systems plug into stats and shots.
relicHooks.bonuses = relicBonuses;
shotHooks.persistent = relicPersistent;
