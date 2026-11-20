import { Rng } from '../math/rng';
import type { Sim } from '../types';
import { PICKUP } from '../world/pools';
import { dropPickup } from './pickups';
import { hitSatellitesArea, hitSatellitesShot, touchSatellites } from './world-events';

// Breakable props of the ground (SIM 1.7.0): the rocks, ice, coral, slag and rift crystals of each sector. They are
// placed per 256-unit chunk from the run seed, so the same run always has them in the same places; the chunks around
// each living probe are live, the rest are not simulated. The probes' weapons break them (a flying shot hits each prop
// once, areas on every damage tick, orbs every few ticks); they never block anything and the weapons never aim at
// them. A broken prop drops components and star dust, and stays broken for the rest of the run.

export const PROP_CHUNK = 256;
const SYNC_TICKS = 10;
const ORB_TICKS = 15;
const FLASH_TICKS = 6;
const scratch: number[] = [];

function chunkKey(cx: number, cy: number): number {
  return (cx + 32768) * 65536 + (cy + 32768);
}

function chunkOf(key: number): { cx: number; cy: number } {
  return { cx: Math.floor(key / 65536) - 32768, cy: (key % 65536) - 32768 };
}

/** A chunk's props: where they stand and which of the biome's looks each has. */
export function propsAt(seed: string, cx: number, cy: number, perChunk: number): { x: number; y: number; look: number }[] {
  const rng = Rng.fromSeed(seed, `props:${cx}:${cy}`);
  const count = rng.int(perChunk + 1);
  const out: { x: number; y: number; look: number }[] = [];
  for (let k = 0; k < count; k++) {
    const x = cx * PROP_CHUNK + 24 + rng.float() * (PROP_CHUNK - 48);
    const y = cy * PROP_CHUNK + 24 + rng.float() * (PROP_CHUNK - 48);
    out.push({ x, y, look: rng.int(3) });
  }
  return out;
}

/** The chunk keys within `pad` of a probe's view, added to `out`. */
function chunksAround(sim: Sim, x: number, y: number, pad: number, out: Set<number>): void {
  const a = sim.content.arena;
  const x0 = Math.floor((x - a.viewW / 2 - pad) / PROP_CHUNK);
  const x1 = Math.floor((x + a.viewW / 2 + pad) / PROP_CHUNK);
  const y0 = Math.floor((y - a.viewH / 2 - pad) / PROP_CHUNK);
  const y1 = Math.floor((y + a.viewH / 2 + pad) / PROP_CHUNK);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) out.add(chunkKey(cx, cy));
}

function rebuildPropGrid(sim: Sim): void {
  const pr = sim.props;
  sim.propGrid.clear();
  for (let i = 0; i < pr.top; i++) if (pr.alive[i]) sim.propGrid.insert(i, pr.x[i]!, pr.y[i]!);
}

function spawnChunk(sim: Sim, key: number): boolean {
  const P = sim.content.props;
  const pr = sim.props;
  const { cx, cy } = chunkOf(key);
  const broken = sim.terrain.broken.get(key) ?? 0;
  const hp = P.hp * (1 + P.hpPerLayer * (sim.layer - 1));
  let any = false;
  const list = propsAt(sim.opts.seed, cx, cy, P.perChunk);
  for (let k = 0; k < list.length; k++) {
    if (broken & (1 << k)) continue;
    const i = pr.spawn();
    if (i < 0) break;
    const d = list[k]!;
    pr.x[i] = d.x;
    pr.y[i] = d.y;
    pr.hp[i] = hp;
    pr.maxHp[i] = hp;
    pr.radius[i] = P.radius;
    pr.look[i] = d.look;
    pr.cx[i] = cx;
    pr.cy[i] = cy;
    pr.slot[i] = k;
    any = true;
  }
  return any;
}

/**
 * Every few ticks: the chunks around the living probes come alive (in key order, so slots are the same on every
 * machine) and the props of chunks no probe is near anymore are released (a broken one stays broken).
 */
export function syncProps(sim: Sim): void {
  const pr = sim.props;
  for (let i = 0; i < pr.top; i++) {
    if (!pr.alive[i]) continue;
    if (pr.flashT[i]! > 0) pr.flashT[i] = pr.flashT[i]! - 1;
    if (pr.touchT[i]! > 0) pr.touchT[i] = pr.touchT[i]! - 1;
  }
  if ((sim.tick - 1) % SYNC_TICKS !== 0 || sim.content.props.perChunk <= 0) return;
  const want = new Set<number>();
  const keep = new Set<number>();
  for (const p of sim.probes) {
    if (!p.alive) continue;
    chunksAround(sim, p.x, p.y, PROP_CHUNK, want);
    chunksAround(sim, p.x, p.y, PROP_CHUNK * 2, keep);
  }
  if (want.size === 0) return;
  let changed = false;
  for (let i = 0; i < pr.top; i++) {
    if (pr.alive[i] && !keep.has(chunkKey(pr.cx[i]!, pr.cy[i]!))) {
      pr.kill(i);
      changed = true;
    }
  }
  const live = new Set(sim.terrain.live.filter((k) => keep.has(k)));
  for (const key of [...want].sort((a, b) => a - b)) {
    if (live.has(key)) continue;
    live.add(key);
    if (spawnChunk(sim, key)) changed = true;
  }
  sim.terrain.live = [...live].sort((a, b) => a - b);
  if (changed) rebuildPropGrid(sim);
}

/** Damages prop `i`; at 0 life it breaks. */
export function damageProp(sim: Sim, i: number, amount: number, probe: number): void {
  const pr = sim.props;
  if (!pr.alive[i] || !(amount > 0)) return;
  pr.hp[i] = pr.hp[i]! - amount;
  pr.flashT[i] = FLASH_TICKS;
  if (pr.hp[i]! <= 0) breakProp(sim, i, probe);
}

function breakProp(sim: Sim, i: number, probe: number): void {
  const pr = sim.props;
  const P = sim.content.props;
  const x = pr.x[i]!;
  const y = pr.y[i]!;
  const key = chunkKey(pr.cx[i]!, pr.cy[i]!);
  sim.terrain.broken.set(key, (sim.terrain.broken.get(key) ?? 0) | (1 << pr.slot[i]!));
  const look = pr.look[i]!;
  pr.kill(i);
  const luck = sim.probes[probe]?.stats.luck ?? 1;
  if (P.components > 0 && sim.rng.loot.chance(Math.min(1, P.componentChance * luck))) dropPickup(sim, PICKUP.component, P.components, x, y - 3);
  const dust = P.dustMin + sim.rng.loot.int(P.dustMax - P.dustMin + 1);
  if (dust > 0) dropPickup(sim, PICKUP.dust, dust, x + 3, y + 2);
  sim.events.push({ t: 'propBreak', x, y, look });
}

/** Props within `radius` of (x, y), passing `inside` when given (cones). */
function propsNear(sim: Sim, x: number, y: number, radius: number, inside?: (dx: number, dy: number) => boolean): number[] {
  const pr = sim.props;
  const out: number[] = [];
  if (pr.count === 0) return out;
  const n = sim.propGrid.query(x, y, radius + sim.content.props.radius, scratch);
  for (let k = 0; k < n; k++) {
    const i = scratch[k]!;
    if (!pr.alive[i] || out.includes(i)) continue;
    const dx = pr.x[i]! - x;
    const dy = pr.y[i]! - y;
    const r = radius + pr.radius[i]!;
    if (dx * dx + dy * dy > r * r) continue;
    if (inside && !inside(dx, dy)) continue;
    out.push(i);
  }
  return out.sort((a, b) => a - b);
}

/** An area's damage tick or a blast: every prop inside takes it. */
export function hitPropsArea(sim: Sim, x: number, y: number, radius: number, damage: number, probe: number, inside?: (dx: number, dy: number) => boolean): void {
  for (const i of propsNear(sim, x, y, radius, inside)) damageProp(sim, i, damage, probe);
  // The abandoned satellites (world events) break the same way.
  hitSatellitesArea(sim, x, y, radius, damage, inside);
}

/** A flying shot passing over props: each one takes its damage once, and the shot flies on. */
export function hitPropsShot(sim: Sim, shot: number): void {
  const s = sim.shots;
  const pr = sim.props;
  for (const i of propsNear(sim, s.x[shot]!, s.y[shot]!, s.radius[shot]!)) {
    if (pr.shot[i] === shot + 1 && pr.shotGen[i] === s.gen[shot]) continue;
    pr.shot[i] = shot + 1;
    pr.shotGen[i] = s.gen[shot]!;
    damageProp(sim, i, s.damage[shot]!, s.owner[shot]!);
  }
  hitSatellitesShot(sim, shot);
}

/** Something that stays in contact (orbs): it hits each prop every few ticks. */
export function touchProps(sim: Sim, x: number, y: number, radius: number, damage: number, probe: number): void {
  const pr = sim.props;
  for (const i of propsNear(sim, x, y, radius)) {
    if (pr.touchT[i]! > 0) continue;
    pr.touchT[i] = ORB_TICKS;
    damageProp(sim, i, damage, probe);
  }
  touchSatellites(sim, x, y, radius, damage);
}
