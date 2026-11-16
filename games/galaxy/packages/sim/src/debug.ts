// Admin debug mode (2026-11-15): helpers an admin's client applies BETWEEN steps of a solo test run (level up,
// invulnerable, heal, clear, summon the Núcleo, skip a layer, grant any upgrade, and a read-out for the panel). They
// are not recorded in the input log: a run that uses them is marked as a test run on the server and pays nothing.
// None of them runs in co-op, where the inputs are shared and the server owns the clock.

import { bossDef, coreLevelFactor, spawnBoss } from './systems/boss';
import { aliveCap, layerSeconds, levelFactor, scaleAt, spawnRate, teamLevel } from './systems/director';
import type { Scale } from './systems/enemies';
import { nextLayer } from './systems/layers';
import { shieldCapacity } from './systems/probes';
import { refreshStats } from './systems/stats';
import { applyOffer, baseOf } from './systems/upgrades';
import { persistentFor } from './systems/weapons';
import { gainXp } from './systems/xp';
import type { Phase, ProbeState, Sim, Stats } from './types';

export type DebugResult = 'ok' | 'not_running' | 'not_waves' | 'slots_full' | 'family_owned' | 'unknown';

/** An upgrade to grant: `replace` is the slot to swap when the slots are full. */
export interface DebugGrant {
  kind: 'weapon' | 'passive' | 'evolution';
  id: string;
  level: number;
  replace?: number;
}

export interface DebugInfo {
  tick: number;
  layer: number;
  phase: Phase;
  layerSeconds: number;
  /** Seconds until the Núcleo comes; 0 once it is up. */
  toCore: number;
  /** Enemies alive (with the Núcleo) and the fauna alone. */
  alive: number;
  fauna: number;
  cap: number;
  /** Groups spawned per second. */
  rate: number;
  teamLevel: number;
  levelFactor: number;
  scale: Scale & { elite: number };
  coreFactor: number;
  boss: { id: string; hp: number; maxHp: number } | null;
  pools: { shots: number; foeShots: number; pickups: number; areas: number; props: number };
  god: boolean;
  level: number;
  hp: number;
  maxHp: number;
  shield: number;
  stats: Stats;
}

function solo(sim: Sim): void {
  if (sim.coop) throw new Error('debug_coop');
}

function running(sim: Sim): boolean {
  solo(sim);
  return sim.status === 'running';
}

/** `n` levels at once: each queues its cards, which open on the next step as usual. */
export function debugLevelUp(sim: Sim, probe: number, n: number): DebugResult {
  if (!running(sim)) return 'not_running';
  const p = sim.probes[probe];
  if (!p?.alive) return 'unknown';
  for (let k = 0; k < n; k++) gainXp(sim, p, p.xpNext - p.xp);
  return 'ok';
}

export function setGod(sim: Sim, on: boolean): DebugResult {
  solo(sim);
  sim.debug = { god: on };
  return 'ok';
}

export function debugHeal(sim: Sim, probe: number): DebugResult {
  if (!running(sim)) return 'not_running';
  const p = sim.probes[probe];
  if (!p?.alive) return 'unknown';
  p.hp = p.stats.maxHp;
  p.shield = shieldCapacity(sim, p);
  return 'ok';
}

function clearFauna(sim: Sim): void {
  const en = sim.enemies;
  for (let e = 0; e < en.top; e++) if (en.alive[e] && !en.boss[e]) en.kill(e);
  const fs = sim.foeShots;
  for (let i = 0; i < fs.top; i++) if (fs.alive[i]) fs.kill(i);
  sim.blasts.length = 0;
}

/** Removes every enemy but the Núcleo, their bullets and pending blasts: no loot, no kills, no events. */
export function debugClear(sim: Sim): DebugResult {
  if (!running(sim)) return 'not_running';
  clearFauna(sim);
  return 'ok';
}

/**
 * The layer's Núcleo now, as `updateLayer` brings it. The layer clock is left alone: moving it would make the director
 * fire every wave of the layer that has not come yet in the same tick.
 */
export function debugSummonCore(sim: Sim): DebugResult {
  if (!running(sim)) return 'not_running';
  if (sim.phase !== 'waves') return 'not_waves';
  if (!bossDef(sim)) return 'unknown';
  sim.phase = 'boss';
  sim.phaseTick = 0;
  spawnBoss(sim);
  return 'ok';
}

/** Straight to the next layer: the Núcleo and the fauna go without a kill, chest or beacon. */
export function debugSkipLayer(sim: Sim): DebugResult {
  if (!running(sim)) return 'not_running';
  if (sim.boss) {
    sim.enemies.kill(sim.boss.index);
    sim.boss = null;
  }
  clearFauna(sim);
  nextLayer(sim);
  return 'ok';
}

/** A weapon's family root: through its evolution's `from` and its variant's `of`, down to the base (2026-11-16). */
function rootOf(c: Sim['content'], id: string): string {
  let at = id;
  for (let guard = 0; guard < 8; guard++) {
    const def = c.weapons.find((w) => w.id === at);
    const next = def?.evolution?.from ?? def?.variant?.of;
    if (!next) return at;
    at = next;
  }
  return at;
}

function clampLevel(level: number, max: number): number {
  return Math.max(1, Math.min(max, Math.floor(level)));
}

/** A weapon into a free slot, or into `replace` (its persistent shots go) when the slots are full. */
function place(sim: Sim, p: ProbeState, id: string, level: number, replace: number | undefined): DebugResult {
  if (p.weapons.length < sim.content.limits.weapons) {
    p.weapons.push({ id, level, t: 0 });
  } else {
    if (replace === undefined || !p.weapons[replace]) return 'slots_full';
    for (const i of persistentFor(sim, p, replace)) sim.shots.kill(i);
    p.weapons[replace] = { id, level, t: 0 };
  }
  refreshStats(sim, p);
  return 'ok';
}

/**
 * Any weapon, passive or evolution at the level asked (clamped to the ones it has). The slot limit holds: with the
 * slots full the caller says which slot to swap. Variants are never granted; a base whose family is already owned (its
 * variant or its evolution) is refused. An evolution needs no passive: its base is put at its max level first.
 */
export function debugGrant(sim: Sim, probe: number, g: DebugGrant): DebugResult {
  if (!running(sim)) return 'not_running';
  const p = sim.probes[probe];
  if (!p?.alive) return 'unknown';
  const c = sim.content;
  if (g.kind === 'passive') {
    const def = c.passives.find((s) => s.id === g.id);
    if (!def) return 'unknown';
    const level = clampLevel(g.level, def.levels.length);
    if (!p.passives.some((s) => s.id === def.id) && p.passives.length >= c.limits.passives) {
      if (g.replace === undefined || !p.passives[g.replace]) return 'slots_full';
      p.passives[g.replace] = { id: def.id, level };
      refreshStats(sim, p);
      return 'ok';
    }
    applyOffer(sim, p, { kind: 'passive', id: def.id, level });
    return 'ok';
  }
  const def = c.weapons.find((w) => w.id === g.id);
  if (!def || def.variant || (g.kind === 'weapon') === Boolean(def.evolution)) return 'unknown';
  if (g.kind === 'weapon') {
    const level = clampLevel(g.level, def.levels.length);
    if (p.weapons.some((w) => w.id === def.id)) {
      applyOffer(sim, p, { kind: 'weapon', id: def.id, level });
      return 'ok';
    }
    if (p.weapons.some((w) => rootOf(c, w.id) === def.id)) return 'family_owned';
    return place(sim, p, def.id, level, g.replace);
  }
  if (p.weapons.some((w) => w.id === def.id)) return 'family_owned';
  const from = def.evolution!.from;
  // Another evolution of the same family already owned (an evolution may come from a variant): one per family.
  const root = rootOf(c, def.id);
  if (p.weapons.some((w) => rootOf(c, w.id) === root && baseOf(c, w.id) !== from)) return 'family_owned';
  if (!p.weapons.some((w) => baseOf(c, w.id) === from)) {
    const base = c.weapons.find((w) => w.id === from);
    if (!base) return 'unknown';
    const placed = place(sim, p, from, base.levels.length, g.replace);
    if (placed !== 'ok') return placed;
  }
  applyOffer(sim, p, { kind: 'evolve', id: def.id, level: 1 });
  return 'ok';
}

/** The read-out of the debug panel, with the director's own numbers. */
export function debugInfo(sim: Sim, probe: number): DebugInfo {
  const p = sim.probes[probe]!;
  const en = sim.enemies;
  const boss = sim.boss;
  const now = layerSeconds(sim);
  return {
    tick: sim.tick,
    layer: sim.layer,
    phase: sim.phase,
    layerSeconds: now,
    toCore: sim.phase === 'waves' ? Math.max(0, sim.sector.layerSeconds - now) : 0,
    alive: en.count,
    fauna: en.count - (boss ? 1 : 0),
    cap: aliveCap(sim),
    rate: spawnRate(sim),
    teamLevel: teamLevel(sim),
    levelFactor: levelFactor(sim),
    scale: scaleAt(sim),
    coreFactor: coreLevelFactor(sim),
    boss: boss ? { id: boss.def, hp: en.hp[boss.index]!, maxHp: en.maxHp[boss.index]! } : null,
    pools: { shots: sim.shots.count, foeShots: sim.foeShots.count, pickups: sim.pickups.count, areas: sim.areas.count, props: sim.props.count },
    god: sim.debug?.god ?? false,
    level: p.level,
    hp: p.hp,
    maxHp: p.stats.maxHp,
    shield: p.shield,
    stats: p.stats,
  };
}
