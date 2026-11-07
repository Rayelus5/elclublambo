import { angleTo, cosA, sinA } from './math/trig';
import { PICKUP } from './world/pools';
import type { Offer, ProbeInput, Sim } from './types';

// A simple, deterministic player for calibration (GDD §5.6) and replay tests. It plays like a keyboard player:
// 16 directions, a new decision every 0.1 s. It steps away from what is close, collects data fragments, heads for the
// extraction beacon when it opens, and otherwise circles the area so the fight stays around it.

const REACH = 110;
const BULLET_REACH = 60;
const DECIDE_EVERY = 6;
const CIRCLE = 160;

const memory = new WeakMap<Sim, { at: number; input: ProbeInput }[]>();

function decide(sim: Sim, probe: number, extractFrom: number): ProbeInput {
  const p = sim.probes[probe]!;
  // Danger: everything close pushes, more the closer it is.
  let dx = 0;
  let dy = 0;
  const en = sim.enemies;
  for (let e = 0; e < en.top; e++) {
    if (!en.alive[e] || en.hackT[e]! > 0) continue;
    const ox = p.x - en.x[e]!;
    const oy = p.y - en.y[e]!;
    const d = Math.sqrt(ox * ox + oy * oy) - en.radius[e]!;
    if (d >= REACH) continue;
    const near = Math.max(0.05, d);
    const w = ((REACH - d) / REACH) * ((REACH - d) / REACH) * (en.boss[e] ? 1.5 : 1);
    dx += (ox / (near + en.radius[e]!)) * w;
    dy += (oy / (near + en.radius[e]!)) * w;
  }
  const fs = sim.foeShots;
  for (let i = 0; i < fs.top; i++) {
    if (!fs.alive[i]) continue;
    const ox = p.x - fs.x[i]!;
    const oy = p.y - fs.y[i]!;
    const d = Math.sqrt(ox * ox + oy * oy);
    if (d >= BULLET_REACH || d < 1e-6) continue;
    const w = ((BULLET_REACH - d) / BULLET_REACH) * 1.5;
    dx += (ox / d) * w;
    dy += (oy / d) * w;
  }
  const danger = Math.sqrt(dx * dx + dy * dy);

  // Goal: the beacon, else the nearest fragment, else a point on a slow circle around the start.
  let gx: number;
  let gy: number;
  const boss = sim.boss;
  if (sim.beacon && sim.layer >= extractFrom) {
    gx = sim.beacon.x - p.x;
    gy = sim.beacon.y - p.y;
  } else if (boss && p.hp > p.stats.maxHp * 0.45) {
    // Fight the boss at mid range: close in, back off, or circle it.
    const bx = sim.enemies.x[boss.index]! - p.x;
    const by = sim.enemies.y[boss.index]! - p.y;
    const d = Math.sqrt(bx * bx + by * by) || 1;
    if (d > 170) {
      gx = bx;
      gy = by;
    } else if (d < 110) {
      gx = -bx;
      gy = -by;
    } else {
      gx = -by;
      gy = bx;
    }
  } else {
    let best = -1;
    let bestD2 = 200 * 200;
    const pk = sim.pickups;
    for (let i = 0; i < pk.top; i++) {
      if (!pk.alive[i] || pk.kind[i] === PICKUP.dust) continue;
      const d2 = (pk.x[i]! - p.x) * (pk.x[i]! - p.x) + (pk.y[i]! - p.y) * (pk.y[i]! - p.y);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best >= 0) {
      gx = pk.x[best]! - p.x;
      gy = pk.y[best]! - p.y;
    } else {
      const a = (sim.tick * 2) % 4096;
      gx = cosA(a) * CIRCLE - p.x;
      gy = sinA(a) * CIRCLE - p.y;
    }
  }
  const glen = Math.sqrt(gx * gx + gy * gy) || 1;
  gx /= glen;
  gy /= glen;
  const vx = danger > 0.35 ? dx / danger + gx * 0.3 : gx + dx;
  const vy = danger > 0.35 ? dy / danger + gy * 0.3 : gy + dy;
  if (Math.abs(vx) + Math.abs(vy) < 1e-6) return { mx: 0, my: 0, aim: -1, pick: -1 };
  // 16 directions, like a keyboard with diagonals and a little more.
  const a = Math.round(angleTo(vx, vy) / 256) * 256;
  return { mx: Math.round(cosA(a) * 127), my: Math.round(sinA(a) * 127), aim: -1, pick: -1 };
}

/** `extractFrom`: the first layer whose beacon the bot goes for (calibration pushes deeper with a high value). */
export function botInput(sim: Sim, probe: number, extractFrom = 1): ProbeInput {
  const p = sim.probes[probe];
  if (!p || !p.alive) return { mx: 0, my: 0, aim: -1, pick: -1 };
  let mem = memory.get(sim);
  if (!mem) {
    mem = [];
    memory.set(sim, mem);
  }
  const last = mem[probe];
  if (last && sim.tick - last.at < DECIDE_EVERY) return last.input;
  const input = decide(sim, probe, extractFrom);
  mem[probe] = { at: sim.tick, input };
  return input;
}

const WEAPON_ORDER = ['nova', 'orbit', 'arc', 'lance', 'drone', 'trail', 'pulse'];
const PASSIVE_ORDER = ['armor', 'regen', 'amplifier', 'capacitor', 'thrusters', 'magnet', 'lens', 'splitter'];

/**
 * The bot's choice, like a normal player: level up what it has, take a few weapons, and keep some armour and repair
 * (the first defensive passives are worth as much as a new weapon).
 */
export function botPick(offer: readonly Offer[]): number {
  let best = 0;
  let bestScore = -Infinity;
  offer.forEach((o, i) => {
    let score = 0;
    if (o.kind === 'weapon') score = (o.level > 1 ? 30 : 22) - WEAPON_ORDER.indexOf(o.id);
    else if (o.kind === 'passive') score = (o.level > 1 ? 20 : 22) - PASSIVE_ORDER.indexOf(o.id) * 2;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
