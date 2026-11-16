import type { Content, EventKind, EventsTuning } from '../content/types';
import { Rng } from '../math/rng';
import { ANGLE_STEPS, cosA, sinA } from '../math/trig';
import type { Sim } from '../types';
import { ticks } from '../version';
import { PICKUP } from '../world/pools';
import { layerSeconds, scaleAt } from './director';
import { spawnEnemy, statusHooks } from './enemies';
import { dropPickup } from './pickups';
import { PROBE_RADIUS } from './probes';
import { worldSchedule } from './world-events';

// In-run events (2026-11-16): besides the satellite, things to go for in each layer — an abandoned ship (stay a few
// seconds inside to loot it), a supply capsule (it lands; touch it) and a bounty hunter (a marked enemy that flees: kill
// it before it escapes). Each layer's plan comes from the run's seed alone (`eventsForLayer`), so the co-op referee,
// every player and the server agree on it; the server pays a run at most what its seed's events could drop
// (`eventLootUpTo`). An event only runs in the layer's waves: when the Núcleo comes, those still going end.

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
  /** Wreck: ticks a probe has been inside. Capsule: ticks left to land. */
  progress: number;
  /** Bounty: its enemy's slot and generation (−1: none). */
  enemy: number;
  enemyGen: number;
}

function duration(t: EventsTuning, kind: EventKind): number {
  return kind === 'wreck' ? t.wreck.life : kind === 'capsule' ? t.capsule.warn + t.capsule.life : t.bounty.seconds;
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
  const distance = T[kind].distance;
  const x = a.x + cosA(angle) * distance;
  const y = a.y + sinA(angle) * distance;
  const ev: ActiveEvent = { kind, layer: sim.layer, seq, x, y, t: ticks(duration(T, kind)), progress: 0, enemy: -1, enemyGen: 0 };
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

/** Its loot, spread around where it was, and the notice of what it dropped. */
function complete(sim: Sim, ev: ActiveEvent, x: number, y: number): void {
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

/** Ends every event going on (a new layer, the Núcleo, the debug mode's clearing). */
export function endRunEvents(sim: Sim): void {
  for (let k = sim.world.active.length - 1; k >= 0; k--) drop(sim, k, 'end');
}

/** The layer's events as they come, and the ones going on. */
export function updateRunEvents(sim: Sim): void {
  const w = sim.world;
  const T = sim.content.events;
  // A new layer: its plan, from the seed.
  if (w.eventsLayer !== sim.layer) {
    endRunEvents(sim);
    w.eventsLayer = sim.layer;
    const sats = w.plan.filter((s) => s.layer === sim.layer).map((s) => s.at);
    w.events = eventsForLayer(sim.opts.seed, T, sim.sector.id, sim.layer, sim.sector.layerSeconds, sats);
    w.eventNext = 0;
  }
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
      // Frozen, it waits; slowed, it flees slower (ice and the like are how to catch it).
      if (d > 1e-6 && Number.isFinite(d) && en.freezeT[e]! <= 0) {
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
    }
    ev.t--;
    if (ev.t <= 0) drop(sim, k, 'fail');
  }
}
