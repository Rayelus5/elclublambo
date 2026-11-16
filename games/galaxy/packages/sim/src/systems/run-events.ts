import { type Content, type EventKind, type EventsTuning, LOOT_KINDS } from '../content/types';
import { Rng } from '../math/rng';
import { ANGLE_STEPS, cosA, sinA } from '../math/trig';
import type { Sim } from '../types';
import { ticks } from '../version';
import { PICKUP } from '../world/pools';
import { layerSeconds, scaleAt } from './director';
import { spawnEnemy, statusHooks } from './enemies';
import { dropPickup } from './pickups';
import { hazardHurt, PROBE_RADIUS } from './probes';
import { worldSchedule } from './world-events';

// In-run events (2026-11-16): besides the satellite, things to go for in each layer — an abandoned ship (stay a few
// seconds inside to loot it), a supply capsule (it lands; touch it) and a bounty hunter (a marked enemy that flees: kill
// it before it escapes) — and hazards to get through: a meteor shower, a Static storm that follows you, an ambush that
// closes round you and a gravity well that pulls you in. Each layer's plan comes from the run's seed alone
// (`eventsForLayer`), so the co-op referee, every player and the server agree on it; the server pays a run at most what
// its seed's events could drop (`eventLootUpTo`). An event only runs in the layer's waves: when the Núcleo comes, those
// still going end.

export interface EventPlan {
  kind: EventKind;
  layer: number;
  /** Seconds into its layer. */
  at: number;
  /** Its place in the layer's plan (the stream its position comes from). */
  seq: number;
}

export interface ActiveEvent {
  kind: EventKind;
  layer: number;
  seq: number;
  x: number;
  y: number;
  /** Ticks left. */
  t: number;
  /**
   * Wreck: ticks a probe has been inside. Capsule: ticks left to land. Meteors: ticks to the next one. Ambush: ticks to
   * the ring. Storm and well: ticks gone (their damage beats every 0,5 s).
   */
  progress: number;
  /** Meteors fallen (each one's own stream of the seed). */
  n: number;
  /** Bounty: its enemy's slot and generation (−1: none). */
  enemy: number;
  enemyGen: number;
}

function duration(t: EventsTuning, kind: EventKind): number {
  switch (kind) {
    case 'wreck':
      return t.wreck.life;
    case 'capsule':
      return t.capsule.warn + t.capsule.life;
    case 'bounty':
      return t.bounty.seconds;
    case 'meteors':
      return t.meteors.seconds;
    case 'storm':
      return t.storm.seconds;
    case 'ambush':
      return t.ambush.warn;
    case 'well':
      return t.well.seconds;
  }
}

/** It brings loot (the hazards bring none). */
export function isLoot(kind: EventKind): kind is (typeof LOOT_KINDS)[number] {
  return (LOOT_KINDS as readonly string[]).includes(kind);
}

function weighted(weights: Record<EventKind, number>, roll: number): EventKind | null {
  const kinds = (Object.keys(weights) as EventKind[]).filter((k) => weights[k] > 0);
  const total = kinds.reduce((a, k) => a + weights[k], 0);
  if (total <= 0) return null;
  let r = roll * total;
  for (const k of kinds) {
    r -= weights[k];
    if (r < 0) return k;
  }
  return kinds[kinds.length - 1]!;
}

/**
 * One layer's events from the seed alone. Every slot draws the same three numbers whatever happens (its chance, its
 * moment, its kind), so the plan never shifts; an event that would not fit (too close to the one before or to the
 * satellite, or past `endBy` before the Núcleo) does not come.
 */
export function eventsForLayer(seed: string, t: EventsTuning, sector: string, layer: number, layerSeconds: number, satellites: readonly number[]): EventPlan[] {
  const rng = Rng.fromSeed(seed, `events:${layer}`);
  const weights = { ...t.weights, ...(t.sectors[sector] ?? {}) } as Record<EventKind, number>;
  const out: EventPlan[] = [];
  let free = -Infinity;
  for (const slot of t.slots) {
    const roll = rng.float();
    const at = slot.from + rng.float() * (slot.to - slot.from);
    const pick = rng.float();
    if (roll >= slot.chance) continue;
    const kind = weighted(weights, pick);
    if (!kind) continue;
    const length = duration(t, kind);
    let start = Math.max(at, free);
    // Away from the satellite too: one thing to go for at a time.
    for (const s of satellites) if (start < s + t.gap && start + length + t.gap > s) start = Math.max(start, s + t.gap);
    if (start > slot.to || start + length + t.endBy > layerSeconds) continue;
    out.push({ kind, layer, at: start, seq: out.length });
    free = start + length + t.gap;
  }
  return out;
}

/** What a loot event of `kind` drops in `layer`. */
export function eventReward(t: EventsTuning, kind: EventKind, layer: number): { coins: number; dust: number; components: number } {
  if (!isLoot(kind)) return { coins: 0, dust: 0, components: 0 };
  const k = t[kind];
  const f = 1 + k.perLayer * (layer - 1);
  return { coins: Math.floor(k.coins * f), dust: Math.floor(k.dust * f), components: Math.floor(k.components * f) };
}

/**
 * The most a run's events could have dropped (the server's bound): the ones its seed had in the layers it reached and
 * whose time had come in the ticks it played. A layer L never starts before (L − 1) × `layerSeconds`.
 */
export function eventLootUpTo(seed: string, content: Content, sector: string, run: { depth: number; ticks: number; layerSeconds: number }): { coins: number; dust: number; components: number } {
  const out = { coins: 0, dust: 0, components: 0 };
  const sats = worldSchedule(seed, content.satellites);
  for (let layer = 1; layer <= run.depth; layer++) {
    const at = sats.filter((s) => s.layer === layer).map((s) => s.at);
    for (const e of eventsForLayer(seed, content.events, sector, layer, run.layerSeconds, at)) {
      if (((layer - 1) * run.layerSeconds + e.at) * 60 > run.ticks) continue;
      const r = eventReward(content.events, e.kind, layer);
      out.coins += r.coins;
      out.dust += r.dust;
      out.components += r.components;
    }
  }
  return out;
}

/** The probe an event comes to: the first one still flying. */
function anchor(sim: Sim) {
  return sim.probes.find((p) => p.alive && (!sim.coop || p.life === 'up')) ?? sim.probes[0]!;
}

/** Starts an event now, where its own stream of the seed says. */
export function startEvent(sim: Sim, kind: EventKind, seq: number): ActiveEvent {
  const T = sim.content.events;
  const a = anchor(sim);
  const rng = Rng.fromSeed(sim.opts.seed, `events:${sim.layer}:${seq}`);
  const angle = rng.int(ANGLE_STEPS);
  // The meteors and the ambush come where the probe is; the others somewhere to go to (or to get away from).
  const distance = kind === 'meteors' || kind === 'ambush' ? 0 : T[kind].distance;
  const x = a.x + cosA(angle) * distance;
  const y = a.y + sinA(angle) * distance;
  const ev: ActiveEvent = { kind, layer: sim.layer, seq, x, y, t: ticks(duration(T, kind)), progress: 0, n: 0, enemy: -1, enemyGen: 0 };
  if (kind === 'ambush') ev.progress = ticks(T.ambush.warn);
  // A capsule lands first (`warn`), then waits its `life`.
  if (kind === 'capsule') {
    ev.progress = ticks(T.capsule.warn);
    ev.t = ticks(T.capsule.life);
  }
  if (kind === 'bounty') {
    const def = sim.content.enemies.find((e) => e.id === sim.sector.spawns[0]?.enemy) ?? sim.content.enemies[0]!;
    const e = spawnEnemy(sim, def, x, y, { scale: scaleAt(sim) });
    if (e >= 0) {
      const en = sim.enemies;
      en.hp[e] = en.hp[e]! * T.bounty.hp;
      en.maxHp[e] = en.hp[e]!;
      // It moves on its own (it flees): the enemies' system leaves it alone.
      en.bounty[e] = 1;
      ev.enemy = e;
      ev.enemyGen = en.gen[e]!;
    }
  }
  sim.world.active.push(ev);
  sim.events.push({ t: 'worldEvent', kind, what: 'appear', x, y });
  return ev;
}

/** Its loot, spread around where it was, and the notice of what it dropped (a hazard got through drops nothing). */
function complete(sim: Sim, ev: ActiveEvent, x: number, y: number): void {
  if (!isLoot(ev.kind)) {
    sim.events.push({ t: 'worldEvent', kind: ev.kind, what: 'done', x, y });
    return;
  }
  const r = eventReward(sim.content.events, ev.kind, ev.layer);
  const drops: [number, number][] = [
    [PICKUP.coin, r.coins],
    [PICKUP.dust, r.dust],
    [PICKUP.component, r.components],
  ];
  let k = 0;
  for (const [kind, total] of drops) {
    for (let left = total; left > 0; ) {
      const piece = Math.min(left, Math.max(1, Math.ceil(total / 5)));
      const a = (k * ANGLE_STEPS) / 12;
      dropPickup(sim, kind, piece, x + cosA(a) * 18, y + sinA(a) * 18);
      left -= piece;
      k++;
    }
  }
  sim.events.push({ t: 'worldEvent', kind: ev.kind, what: 'done', x, y, coins: r.coins, dust: r.dust, components: r.components });
}

function inside(sim: Sim, x: number, y: number, radius: number): boolean {
  const r = radius + PROBE_RADIUS;
  for (const p of sim.probes) {
    if (!p.alive || p.life !== 'up') continue;
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/** Ends an event without its prize (a bounty that got away leaves the field). */
function drop(sim: Sim, k: number, what: 'fail' | 'end'): void {
  const ev = sim.world.active[k]!;
  if (ev.kind === 'bounty' && ev.enemy >= 0 && sim.enemies.alive[ev.enemy] && sim.enemies.gen[ev.enemy] === ev.enemyGen) sim.enemies.kill(ev.enemy);
  sim.world.active.splice(k, 1);
  sim.events.push({ t: 'worldEvent', kind: ev.kind, what, x: ev.x, y: ev.y });
}

/** The probes standing up (a hazard only goes for them). */
function standing(sim: Sim) {
  return sim.probes.filter((p) => p.alive && (!sim.coop || p.life === 'up'));
}

/** The probe nearest (x, y) of those standing up, or null. */
function nearestStanding(sim: Sim, x: number, y: number) {
  let best = null;
  let bestD = Infinity;
  for (const p of standing(sim)) {
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** One meteor: within `spread` of a probe (each in turn), warned, then a blast (systems/blasts.ts). */
function meteor(sim: Sim, ev: ActiveEvent): void {
  const T = sim.content.events.meteors;
  const up = standing(sim);
  if (up.length === 0) return;
  const p = up[ev.n % up.length]!;
  const rng = Rng.fromSeed(sim.opts.seed, `meteor:${ev.layer}:${ev.seq}:${ev.n}`);
  ev.n++;
  const a = rng.int(ANGLE_STEPS);
  const r = rng.float() * T.spread;
  const x = p.x + cosA(a) * r;
  const y = p.y + sinA(a) * r;
  const wait = ticks(T.warn);
  sim.blasts.push({ x, y, radius: T.radius, damage: p.stats.maxHp * T.damage, at: sim.tick + wait });
  sim.events.push({ t: 'telegraph', kind: 'meteor', x, y, angle: 0, ticks: wait, radius: T.radius });
}

/** The ambush closes: a ring of the sector's fauna round the probe it came for. */
function ambush(sim: Sim, ev: ActiveEvent): void {
  const T = sim.content.events.ambush;
  const p = nearestStanding(sim, ev.x, ev.y);
  if (!p) return;
  const now = layerSeconds(sim);
  const kinds = sim.sector.spawns.filter((s) => s.from <= now).map((s) => sim.content.enemies.find((e) => e.id === s.enemy)).filter((d) => d !== undefined);
  if (kinds.length === 0) return;
  const count = Math.floor(T.count + T.perLayer * (ev.layer - 1));
  const scale = scaleAt(sim);
  const start = Rng.fromSeed(sim.opts.seed, `ambush:${ev.layer}:${ev.seq}`).int(ANGLE_STEPS);
  for (let k = 0; k < count; k++) {
    const a = start + Math.floor((k * ANGLE_STEPS) / Math.max(1, count));
    // Mostly the sector's first fauna; every fourth one of the others it has by now.
    const def = k % 4 === 3 && kinds.length > 1 ? kinds[1 + ((k >> 2) % (kinds.length - 1))]! : kinds[0]!;
    spawnEnemy(sim, def, p.x + cosA(a) * T.distance, p.y + sinA(a) * T.distance, { scale });
  }
}

/** Ends every event going on (a new layer, the Núcleo, the debug mode's clearing). */
export function endRunEvents(sim: Sim): void {
  for (let k = sim.world.active.length - 1; k >= 0; k--) drop(sim, k, 'end');
}

/** A new layer: the events going on end and its plan comes, from the seed. */
export function syncEventsLayer(sim: Sim): void {
  const w = sim.world;
  if (w.eventsLayer === sim.layer) return;
  endRunEvents(sim);
  w.eventsLayer = sim.layer;
  const sats = w.plan.filter((s) => s.layer === sim.layer).map((s) => s.at);
  w.events = eventsForLayer(sim.opts.seed, sim.content.events, sim.sector.id, sim.layer, sim.sector.layerSeconds, sats);
  w.eventNext = 0;
}

/** The layer's events as they come, and the ones going on. */
export function updateRunEvents(sim: Sim): void {
  const w = sim.world;
  const T = sim.content.events;
  syncEventsLayer(sim);
  // Only in the waves: the Núcleo ends what is still going.
  if (sim.phase !== 'waves') {
    endRunEvents(sim);
    return;
  }
  const due = w.events[w.eventNext];
  if (due && layerSeconds(sim) >= due.at) {
    w.eventNext++;
    startEvent(sim, due.kind, due.seq);
  }
  const en = sim.enemies;
  for (let k = w.active.length - 1; k >= 0; k--) {
    const ev = w.active[k]!;
    if (ev.kind === 'bounty') {
      const e = ev.enemy;
      if (e < 0) {
        drop(sim, k, 'fail');
        continue;
      }
      if (!en.alive[e] || en.gen[e] !== ev.enemyGen) {
        // Killed: its prize where it fell.
        w.active.splice(k, 1);
        complete(sim, ev, ev.x, ev.y);
        continue;
      }
      // It flees from the nearest probe.
      let best = Infinity;
      let fx = 0;
      let fy = 0;
      for (const p of sim.probes) {
        if (!p.alive) continue;
        const dx = en.x[e]! - p.x;
        const dy = en.y[e]! - p.y;
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          fx = dx;
          fy = dy;
        }
      }
      const d = Math.sqrt(best);
      // Frozen, it waits; slowed, it flees slower (ice and the like are how to catch it). Hacked, on a harpoon's line or
      // thrown by the sling, something else moves it.
      const h = en.held[e]!;
      const held = h > 0 && sim.shots.alive[h - 1] && sim.shots.gen[h - 1] === en.heldGen[e];
      if (d > 1e-6 && Number.isFinite(d) && en.freezeT[e]! <= 0 && en.hackT[e]! <= 0 && !held) {
        const v = (T.bounty.speed * statusHooks.speedFactor(sim, e)) / 60;
        en.x[e] = en.x[e]! + (fx / d) * v;
        en.y[e] = en.y[e]! + (fy / d) * v;
      }
      ev.x = en.x[e]!;
      ev.y = en.y[e]!;
    } else if (ev.kind === 'wreck') {
      if (inside(sim, ev.x, ev.y, T.wreck.radius)) ev.progress++;
      if (ev.progress >= ticks(T.wreck.hold)) {
        w.active.splice(k, 1);
        complete(sim, ev, ev.x, ev.y);
        continue;
      }
    } else if (ev.kind === 'capsule') {
      if (ev.progress > 0) {
        ev.progress--;
        continue;
      }
      if (inside(sim, ev.x, ev.y, T.capsule.radius)) {
        w.active.splice(k, 1);
        complete(sim, ev, ev.x, ev.y);
        continue;
      }
    } else if (ev.kind === 'meteors') {
      if (ev.progress > 0) ev.progress--;
      else {
        meteor(sim, ev);
        ev.progress = ticks(T.meteors.every);
      }
    } else if (ev.kind === 'ambush') {
      // Its warning follows the probe it came for; then the ring closes, and it is done.
      const p = nearestStanding(sim, ev.x, ev.y);
      if (p) {
        ev.x = p.x;
        ev.y = p.y;
      }
      if (ev.progress > 0) ev.progress--;
      if (ev.progress <= 0) {
        ambush(sim, ev);
        w.active.splice(k, 1);
        complete(sim, ev, ev.x, ev.y);
        continue;
      }
    } else if (ev.kind === 'storm') {
      // It drifts to the nearest probe, slower than any: walking away is the answer.
      ev.progress++;
      const p = nearestStanding(sim, ev.x, ev.y);
      if (p) {
        const dx = p.x - ev.x;
        const dy = p.y - ev.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const step = T.storm.speed / 60;
        if (d > step) {
          ev.x += (dx / d) * step;
          ev.y += (dy / d) * step;
        }
      }
      if (ev.progress % 30 === 0) hurtWithin(sim, ev.x, ev.y, T.storm.radius, T.storm.damage);
    } else if (ev.kind === 'well') {
      ev.progress++;
      pull(sim, ev.x, ev.y, T.well.radius, T.well.pull);
      if (ev.progress % 30 === 0) hurtWithin(sim, ev.x, ev.y, T.well.core, T.well.damage);
    }
    ev.t--;
    // A hazard got through is done; a loot event whose time ran out is lost.
    if (ev.t <= 0) {
      if (isLoot(ev.kind)) drop(sim, k, 'fail');
      else {
        w.active.splice(k, 1);
        complete(sim, ev, ev.x, ev.y);
      }
    }
  }
}

/** Half a second of `rate` × maximum life to the probes standing within `radius` (armour and the hit cap count, no breather). */
function hurtWithin(sim: Sim, x: number, y: number, radius: number, rate: number): void {
  const r = radius + PROBE_RADIUS;
  for (const p of standing(sim)) {
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy <= r * r) hazardHurt(sim, p, p.stats.maxHp * rate * 0.5);
  }
}

/** Pulls the probes standing and the loot lying within `radius` towards (x, y): `strength` a second at the heart, none at the edge. */
function pull(sim: Sim, x: number, y: number, radius: number, strength: number): void {
  const at = (px: number, py: number): [number, number] => {
    const dx = x - px;
    const dy = y - py;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= radius || d < 1) return [0, 0];
    const v = ((strength / 60) * (1 - d / radius)) / d;
    return [dx * v, dy * v];
  };
  for (const p of standing(sim)) {
    const [mx, my] = at(p.x, p.y);
    p.x += mx;
    p.y += my;
  }
  const pk = sim.pickups;
  for (let i = 0; i < pk.top; i++) {
    if (!pk.alive[i] || pk.magnet[i]) continue;
    const [mx, my] = at(pk.x[i]!, pk.y[i]!);
    pk.x[i] = pk.x[i]! + mx;
    pk.y[i] = pk.y[i]! + my;
  }
}

