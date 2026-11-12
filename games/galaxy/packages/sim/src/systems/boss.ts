import type { BossDef, BossPattern, SectorDef } from '../content/types';
import { angleTo, ANGLE_STEPS, cosA, degToSteps, sinA } from '../math/trig';
import type { BossState, Sim } from '../types';
import { ticks } from '../version';
import { scaleAt } from './director';
import { angleDiff, fireFoeBullet, nearestProbe, probesCentre, spawnEnemy } from './enemies';
import { hurtProbe, PROBE_RADIUS } from './probes';
import { coopFactor } from './coop';

// The Static Core (GDD §5.5): a boss with phases that change with its life, and a cycle of patterns that are always
// announced before they hit (a burst warning, the wind-up of a charge, the line of a laser, the marks on the ground).

const SPAWN_DISTANCE = 260;

/**
 * The Core of `layer` in `sector` (GDD §5.5; Nov plan B4): every `every` layers its deep Core, which takes the forms of
 * its cycle by how many times it has come; any other layer, the sector's forms in turn, the deep layers not counting
 * (with a deep Core every 4: 1, 2, 3, deep, 1, 2, 3, deep…). Without cycles, always `boss` (content published before).
 */
export function bossIdAt(sector: SectorDef, layer: number): string {
  const deep = sector.deepBoss;
  if (deep && layer % deep.every === 0) {
    const cycle = deep.cycle?.length ? deep.cycle : [deep.boss];
    return cycle[(layer / deep.every - 1) % cycle.length]!;
  }
  const cycle = sector.bossCycle?.length ? sector.bossCycle : [sector.boss];
  const skipped = deep ? Math.floor((layer - 1) / deep.every) : 0;
  return cycle[(layer - 1 - skipped) % cycle.length]!;
}

/** The Core of the current layer (`bossIdAt`). */
export function bossDef(sim: Sim): BossDef | undefined {
  const id = bossIdAt(sim.sector, sim.layer);
  return sim.content.bosses.find((b) => b.id === id);
}

/** True while the Core is away in a blink: it neither takes nor deals damage. */
export function bossAway(sim: Sim, e: number): boolean {
  return sim.boss !== null && sim.boss.index === e && sim.boss.active?.kind === 'blink';
}

/**
 * Damage multiplier of the boss: its layer, the sector's toughness, the group and the season's anomaly (Nov plan B1:
 * before, a Núcleo hit as hard in the hardest sector as in the first).
 */
function layerDamage(sim: Sim, def: BossDef): number {
  return (1 + def.scaling.damagePerLayer * (sim.layer - 1)) * sim.sector.enemyDamage * coopFactor(sim, 'enemyDamage') * (sim.anomaly?.enemyDamage ?? 1);
}

export function spawnBoss(sim: Sim): void {
  const def = bossDef(sim);
  if (!def) return;
  const en = sim.enemies;
  const i = en.spawn();
  if (i < 0) return;
  const c = probesCentre(sim);
  const a = sim.rng.spawn.int(ANGLE_STEPS);
  const hp = def.hp * (1 + def.scaling.hpPerLayer * (sim.layer - 1)) * coopFactor(sim, 'bossHp') * sim.sector.enemyHp * (sim.anomaly?.enemyHp ?? 1);
  en.type[i] = sim.content.bosses.indexOf(def);
  en.boss[i] = 1;
  en.x[i] = c.x + cosA(a) * SPAWN_DISTANCE;
  en.y[i] = c.y + sinA(a) * SPAWN_DISTANCE;
  en.px[i] = en.x[i]!;
  en.py[i] = en.y[i]!;
  en.hp[i] = hp;
  en.maxHp[i] = hp;
  en.radius[i] = def.radius;
  en.speed[i] = def.speed;
  en.damage[i] = def.damage * layerDamage(sim, def);
  en.facing[i] = angleTo(c.x - en.x[i]!, c.y - en.y[i]!);
  sim.boss = { index: i, def: def.id, phase: 0, t: ticks(def.phases[0]!.interval), cursor: 0, active: null };
  sim.events.push({ t: 'bossSpawn', boss: def.id, layer: sim.layer });
}

function patternFor(def: BossDef, phase: number, cursor: number): BossPattern {
  const list = def.phases[phase]!.patterns;
  return list[cursor % list.length]!;
}

function fire(sim: Sim, def: BossDef, p: BossPattern): void {
  const b = sim.boss!;
  const en = sim.enemies;
  const x = en.x[b.index]!;
  const y = en.y[b.index]!;
  const dmg = layerDamage(sim, def);
  const target = nearestProbe(sim, x, y);
  const aim = target ? angleTo(target.x - x, target.y - y) : en.facing[b.index]!;
  switch (p.kind) {
    case 'radial':
      for (let k = 0; k < p.count; k++) fireFoeBullet(sim, x, y, aim + Math.round((k * ANGLE_STEPS) / p.count), p.speed, p.damage * dmg);
      return;
    case 'aimed': {
      const spread = degToSteps(p.spread);
      for (let k = 0; k < p.count; k++) {
        const off = p.count > 1 ? Math.round((k - (p.count - 1) / 2) * (spread / (p.count - 1))) : 0;
        fireFoeBullet(sim, x, y, aim + off, p.speed, p.damage * dmg);
      }
      return;
    }
    case 'summon': {
      const minion = sim.content.enemies.find((e) => e.id === p.enemy);
      if (!minion) return;
      const scale = scaleAt(sim);
      for (let k = 0; k < p.count; k++) {
        const a = Math.round((k * ANGLE_STEPS) / p.count);
        spawnEnemy(sim, minion, x + cosA(a) * (en.radius[b.index]! + 14), y + sinA(a) * (en.radius[b.index]! + 14), { scale });
      }
      return;
    }
    case 'spiral':
      b.active = { kind: 'spiral', t: ticks(p.duration), a: aim };
      return;
    case 'charge':
      b.active = { kind: 'windup', t: ticks(p.windup), a: aim };
      sim.events.push({ t: 'telegraph', kind: 'charge', x, y, angle: aim, ticks: ticks(p.windup), radius: p.dashSpeed * p.dashTime });
      return;
    case 'wall': {
      // A ring with a hole somewhere: the way out is there, not behind.
      const hole = sim.rng.ai.int(ANGLE_STEPS);
      const half = degToSteps(p.gap) / 2;
      for (let k = 0; k < p.count; k++) {
        const a = aim + Math.round((k * ANGLE_STEPS) / p.count);
        if (Math.abs(angleDiff(a, hole)) <= half) continue;
        fireFoeBullet(sim, x, y, a, p.speed, p.damage * dmg);
      }
      return;
    }
    case 'mines': {
      if (!target) return;
      const at = sim.tick + ticks(p.delay);
      for (let k = 0; k < p.count; k++) {
        const a = sim.rng.ai.int(ANGLE_STEPS);
        // Uniform over the disc: the square root keeps them from crowding the centre.
        const r = p.spread * Math.sqrt(sim.rng.ai.float());
        const mx = target.x + cosA(a) * r;
        const my = target.y + sinA(a) * r;
        sim.blasts.push({ x: mx, y: my, radius: p.radius, damage: p.damage * dmg, at });
        sim.events.push({ t: 'telegraph', kind: 'explode', x: mx, y: my, angle: 0, ticks: ticks(p.delay), radius: p.radius });
      }
      return;
    }
    case 'blink': {
      const centre = target ?? { x, y };
      const a = sim.rng.ai.int(ANGLE_STEPS);
      en.tx[b.index] = centre.x + cosA(a) * p.offset;
      en.ty[b.index] = centre.y + sinA(a) * p.offset;
      b.active = { kind: 'blink', t: ticks(p.windup), a };
      sim.events.push({ t: 'telegraph', kind: 'blink', x: en.tx[b.index]!, y: en.ty[b.index]!, angle: a, ticks: ticks(p.windup), radius: en.radius[b.index]! });
      return;
    }
    case 'laser': {
      // The line points at the probe; the beam then turns to a side drawn at random, and the warning shows which.
      const arc = (sim.rng.ai.int(2) === 0 ? -1 : 1) * degToSteps(p.sweep);
      b.active = { kind: 'aim', t: ticks(p.windup), a: aim, arc };
      sim.events.push({ t: 'telegraph', kind: 'laser', x, y, angle: aim, ticks: ticks(p.windup), radius: p.length, arc });
      return;
    }
    case 'closing': {
      // Marked around where the probe stands now, with its way out at random; the bullets come when the mark is full.
      if (!target) return;
      const hole = sim.rng.ai.int(ANGLE_STEPS);
      b.active = { kind: 'closing', t: ticks(p.delay), a: hole, x: target.x, y: target.y };
      sim.events.push({ t: 'telegraph', kind: 'closing', x: target.x, y: target.y, angle: hole, ticks: ticks(p.delay), radius: p.radius, arc: degToSteps(p.gap) });
      return;
    }
    case 'barrage': {
      // A line of blasts walking from the Core towards the probe, each one warned until it goes off.
      for (let k = 0; k < p.count; k++) {
        const d = p.spacing * (k + 1);
        const mx = x + cosA(aim) * d;
        const my = y + sinA(aim) * d;
        const wait = ticks(p.delay) + k * ticks(p.step);
        sim.blasts.push({ x: mx, y: my, radius: p.radius, damage: p.damage * dmg, at: sim.tick + wait });
        sim.events.push({ t: 'telegraph', kind: 'explode', x: mx, y: my, angle: 0, ticks: wait, radius: p.radius });
      }
      return;
    }
  }
}

/** Where a laser's beam points `act.t` ticks before it ends: from its first line, turned by the share of `arc` done. */
function laserAngle(act: NonNullable<BossState['active']>, p: Extract<BossPattern, { kind: 'laser' }>): number {
  const total = Math.max(1, ticks(p.duration));
  return act.a + Math.round(((act.arc ?? 0) * (total - act.t)) / total);
}

/** The beam burns every probe within half its width of its segment (the usual breather stops a hit every tick). */
function burnLaser(sim: Sim, def: BossDef, p: Extract<BossPattern, { kind: 'laser' }>, angle: number): void {
  const en = sim.enemies;
  const x = en.x[sim.boss!.index]!;
  const y = en.y[sim.boss!.index]!;
  const cx = cosA(angle);
  const cy = sinA(angle);
  const r = p.width / 2 + PROBE_RADIUS;
  for (const probe of sim.probes) {
    if (!probe.alive) continue;
    const dx = probe.x - x;
    const dy = probe.y - y;
    const along = Math.min(p.length, Math.max(0, dx * cx + dy * cy));
    const ox = dx - cx * along;
    const oy = dy - cy * along;
    if (ox * ox + oy * oy <= r * r) hurtProbe(sim, probe, p.damage * layerDamage(sim, def));
  }
}

/** The Core's laser while it burns, for the renderer (Nov plan B4); null when there is none. */
export function activeLaser(sim: Sim): { x: number; y: number; angle: number; length: number; width: number } | null {
  const b = sim.boss;
  if (!b || b.active?.kind !== 'laser') return null;
  const def = sim.content.bosses.find((x) => x.id === b.def);
  if (!def) return null;
  const p = patternFor(def, b.phase, b.cursor - 1);
  if (p.kind !== 'laser') return null;
  return { x: sim.enemies.x[b.index]!, y: sim.enemies.y[b.index]!, angle: laserAngle(b.active, p), length: p.length, width: p.width };
}

/** Runs the pattern in progress (spiral, charge…); true while the boss must not walk. */
function runActive(sim: Sim, def: BossDef): boolean {
  const b = sim.boss!;
  const act = b.active;
  if (!act) return false;
  const en = sim.enemies;
  const e = b.index;
  const p = patternFor(def, b.phase, b.cursor - 1);
  act.t--;
  if (act.kind === 'spiral' && p.kind === 'spiral') {
    const every = Math.max(1, ticks(p.every));
    const elapsed = ticks(p.duration) - act.t - 1;
    if (elapsed % every === 0) {
      fireFoeBullet(sim, en.x[e]!, en.y[e]!, act.a, p.speed, p.damage * layerDamage(sim, def));
      act.a = (act.a + degToSteps(p.step)) % ANGLE_STEPS;
    }
    if (act.t <= 0) b.active = null;
    return false;
  }
  if (act.kind === 'blink' && p.kind === 'blink') {
    if (act.t > 0) return true;
    const fx = en.x[e]!;
    const fy = en.y[e]!;
    en.x[e] = en.tx[e]!;
    en.y[e] = en.ty[e]!;
    en.px[e] = en.x[e]!;
    en.py[e] = en.y[e]!;
    b.active = null;
    sim.events.push({ t: 'blink', fx, fy, tx: en.x[e]!, ty: en.y[e]! });
    const dmg = layerDamage(sim, def);
    for (let k = 0; k < p.count; k++) fireFoeBullet(sim, en.x[e]!, en.y[e]!, act.a + Math.round((k * ANGLE_STEPS) / p.count), p.speed, p.damage * dmg);
    return true;
  }
  if (act.kind === 'windup' && p.kind === 'charge') {
    if (act.t <= 0) b.active = { kind: 'dash', t: ticks(p.dashTime), a: act.a };
    return true;
  }
  if (act.kind === 'dash' && p.kind === 'charge') {
    en.x[e] = en.x[e]! + (cosA(act.a) * p.dashSpeed) / 60;
    en.y[e] = en.y[e]! + (sinA(act.a) * p.dashSpeed) / 60;
    for (const probe of sim.probes) {
      if (!probe.alive) continue;
      const r = PROBE_RADIUS + en.radius[e]!;
      const dx = probe.x - en.x[e]!;
      const dy = probe.y - en.y[e]!;
      if (dx * dx + dy * dy <= r * r) hurtProbe(sim, probe, p.damage * layerDamage(sim, def));
    }
    if (act.t <= 0) b.active = null;
    return true;
  }
  if (act.kind === 'aim' && p.kind === 'laser') {
    // The warning is over: the beam burns from its first line on this very tick.
    if (act.t > 0) return true;
    b.active = { kind: 'laser', t: Math.max(1, ticks(p.duration)), a: act.a, arc: act.arc ?? 0 };
    burnLaser(sim, def, p, act.a);
    return true;
  }
  if (act.kind === 'laser' && p.kind === 'laser') {
    burnLaser(sim, def, p, laserAngle(act, p));
    if (act.t <= 0) b.active = null;
    return true;
  }
  if (act.kind === 'closing' && p.kind === 'closing') {
    // The Core keeps walking while its ring is only marked.
    if (act.t > 0) return false;
    b.active = null;
    const half = degToSteps(p.gap) / 2;
    // They die at the centre, so the ring never opens out again on the far side.
    const life = Math.max(1, ticks(p.radius / p.speed));
    const dmg = p.damage * layerDamage(sim, def);
    for (let k = 0; k < p.count; k++) {
      const a = act.a + Math.round(((k + 0.5) * ANGLE_STEPS) / p.count);
      if (Math.abs(angleDiff(act.a, a)) <= half) continue;
      const i = fireFoeBullet(sim, act.x! + cosA(a) * p.radius, act.y! + sinA(a) * p.radius, a + ANGLE_STEPS / 2, p.speed, dmg);
      if (i >= 0) sim.foeShots.ttl[i] = life;
    }
    return false;
  }
  b.active = null;
  return false;
}

/** Running patterns a stun drops: their warnings run on without them (a blink, already away, is never stunned). */
const STUN_DROPS = new Set(['windup', 'aim', 'laser', 'closing']);

/** One tick of the boss: phase changes, its pattern clock and its walk. */
export function updateBoss(sim: Sim): void {
  const b = sim.boss;
  if (!b) return;
  const def = sim.content.bosses.find((x) => x.id === b.def);
  const en = sim.enemies;
  if (!def || !en.alive[b.index] || !en.boss[b.index]) return;
  const e = b.index;
  // Stunned (a reaction): no movement, no patterns, the clocks stand still.
  if (en.freezeT[e]! > 0) {
    en.freezeT[e] = en.freezeT[e]! - 1;
    // A charge being wound up is dropped, and so are a laser and a closing ring (Nov plan B4).
    if (b.active && STUN_DROPS.has(b.active.kind)) b.active = null;
    return;
  }

  const frac = en.hp[e]! / en.maxHp[e]!;
  let changed = false;
  while (b.phase + 1 < def.phases.length && frac <= def.phases[b.phase + 1]!.below) {
    b.phase++;
    changed = true;
  }
  if (changed) {
    b.cursor = 0;
    b.active = null;
    b.t = ticks(def.phases[b.phase]!.interval);
    sim.events.push({ t: 'bossPhase', phase: b.phase });
  }
  const phase = def.phases[b.phase]!;

  const busy = runActive(sim, def);
  if (!busy) {
    const target = nearestProbe(sim, en.x[e]!, en.y[e]!);
    if (target) {
      const dx = target.x - en.x[e]!;
      const dy = target.y - en.y[e]!;
      const d = Math.sqrt(dx * dx + dy * dy);
      const reach = en.radius[e]! + PROBE_RADIUS;
      if (d > reach) {
        const stepLen = Math.min((en.speed[e]! * phase.speed) / 60, d - reach);
        en.x[e] = en.x[e]! + (dx / d) * stepLen;
        en.y[e] = en.y[e]! + (dy / d) * stepLen;
      }
      en.facing[e] = angleTo(dx, dy);
    }
  }
  if (b.active) return;
  b.t--;
  const next = patternFor(def, b.phase, b.cursor);
  const warn = ticks(phase.telegraph);
  if (b.t === warn && next.kind !== 'charge') {
    sim.events.push({ t: 'telegraph', kind: 'burst', x: en.x[e]!, y: en.y[e]!, angle: en.facing[e]!, ticks: warn, radius: en.radius[e]! * 2 });
  }
  if (b.t <= 0) {
    b.cursor++;
    fire(sim, def, next);
    b.t = ticks(phase.interval);
  }
}
