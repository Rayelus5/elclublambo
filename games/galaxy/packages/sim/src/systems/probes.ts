import { angleTo } from '../math/trig';
import { IDLE, type ProbeInput, type ProbeState, type Sim } from '../types';
import { ticks } from '../version';
import { downProbe } from './coop';
import { tickDash } from './dash';
import { onContact, rescue, tickQuirk } from './quirks';

// Probes (GDD §5.2, §6): movement from per-tick inputs, contact damage with half a second of invulnerability, shield,
// regeneration, and death. The run ends when every probe is down.

export const PROBE_RADIUS = 7;
export const INVULN_SECONDS = 0.5;
/** The Deflector's barrier recharges 3 s after the last hit, 10 % of its capacity per second. */
const BARRIER_DELAY = 3;
const BARRIER_RATE = 0.1;

/** Relic shields (elliptical) registered in `fx` plus the barrier: one pool, one cap. */
function relicShield(p: ProbeState): number {
  let c = 0;
  for (let k = 0; k < p.relics.length; k++) c += p.fx['shieldMax' + k] ?? 0;
  return c;
}

export function shieldCapacity(_sim: Sim, p: ProbeState): number {
  return relicShield(p) + p.stats.barrier * p.stats.maxHp;
}

function clampAxis(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-127, Math.min(127, Math.trunc(v)));
}

export function moveProbes(sim: Sim, inputs: readonly ProbeInput[]): void {
  for (const p of sim.probes) {
    if (!p.alive) continue;
    const input = inputs[p.index] ?? IDLE;
    const mx = clampAxis(input.mx);
    const my = clampAxis(input.my);
    const len = Math.sqrt(mx * mx + my * my);
    if (len > 0) {
      const scale = (len > 127 ? 127 / len : 1) / 127;
      const perTick = p.stats.speed / 60;
      p.x += mx * scale * perTick;
      p.y += my * scale * perTick;
      p.facing = angleTo(mx, my);
      p.moving = true;
    } else {
      p.moving = false;
    }
    const aim = Math.trunc(input.aim);
    p.aim = Number.isFinite(input.aim) && aim >= 0 && aim < 4096 ? aim : p.facing;
  }
}

/**
 * Damage to a probe: armor first, then the shield, then life. Starts the invulnerability window. With `keep`, the hit
 * takes at most `1 - keep` of the life the probe has (a volatile elite's blast never kills on its own: 2026-11-14).
 */
export function hurtProbe(sim: Sim, p: ProbeState, amount: number, opts?: { keep?: number }): void {
  if (!p.alive || p.invulnT > 0 || amount <= 0) return;
  // Fase cuántica (Nov plan B2): the hit goes through; the usual breather follows, so contact does not hit next tick.
  if (p.stats.evasion > 0 && sim.rng.combat.chance(p.stats.evasion)) {
    p.invulnT = ticks(INVULN_SECONDS);
    sim.events.push({ t: 'evade', probe: p.index });
    return;
  }
  let dmg = amount * (1 - p.stats.armor);
  const absorbed = Math.min(p.shield, dmg);
  p.shield -= absorbed;
  dmg -= absorbed;
  if (opts?.keep !== undefined) dmg = Math.min(dmg, p.hp * (1 - opts.keep));
  p.hp -= dmg;
  p.invulnT = ticks(INVULN_SECONDS);
  p.fx['lastHurt'] = sim.tick;
  sim.events.push({ t: 'hurt', probe: p.index, amount: dmg + absorbed });
  if (p.hp <= 0 && rescue(sim, p)) return;
  // Co-op: it falls and waits for a teammate (systems/coop.ts).
  if (p.hp <= 0 && sim.coop) {
    downProbe(sim, p);
    return;
  }
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    sim.events.push({ t: 'probeDown', probe: p.index });
    if (sim.probes.every((q) => !q.alive)) sim.status = 'dead';
  }
}

const near: number[] = [];

export function contactDamage(sim: Sim, maxRadius: number): void {
  const en = sim.enemies;
  for (const p of sim.probes) {
    if (!p.alive || p.invulnT > 0) continue;
    const n = sim.grid.query(p.x, p.y, PROBE_RADIUS + maxRadius, near);
    for (let k = 0; k < n; k++) {
      const e = near[k]!;
      // A Core away in its blink touches nothing (systems/boss.ts `bossAway`, inline: boss.ts imports this file).
      if (!en.alive[e] || en.hackT[e]! > 0 || en.fuseT[e]! > 0 || (sim.boss?.index === e && sim.boss.active?.kind === 'blink')) continue;
      // On a harpoon's line or thrown by the sling (inline `heldBy`, enemies.ts imports this file): it is the probe's
      // projectile now and touches nobody (review B, I1).
      const h = en.held[e]!;
      if (h > 0 && sim.shots.alive[h - 1] && sim.shots.gen[h - 1] === en.heldGen[e]) continue;
      const dx = en.x[e]! - p.x;
      const dy = en.y[e]! - p.y;
      const r = PROBE_RADIUS + en.radius[e]!;
      if (dx * dx + dy * dy < r * r) {
        const before = p.hp + p.shield;
        hurtProbe(sim, p, en.damage[e]!);
        if (p.hp + p.shield < before) onContact(sim, p, e, en.damage[e]!);
        break;
      }
    }
  }
}

export function tickProbes(sim: Sim): void {
  for (const p of sim.probes) {
    if (!p.alive) continue;
    if (p.invulnT > 0) p.invulnT--;
    tickQuirk(sim, p);
    tickDash(sim, p);
    if (p.stats.regen > 0) p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.regen / 60);
    rechargeShield(sim, p);
  }
}

/** Each part of the shield recharges on its own clock (relics after their delay, the barrier after 3 s). */
function rechargeShield(sim: Sim, p: ProbeState): void {
  const relic = relicShield(p);
  const barrier = p.stats.barrier * p.stats.maxHp;
  const cap = relic + barrier;
  if (!(cap > 0) || p.shield >= cap) return;
  const since = sim.tick - (p.fx['lastHurt'] ?? -1e9);
  let gain = 0;
  if (relic > 0 && since >= ticks(sim.content.relics.families.shield.recharge)) gain += relic / 60;
  if (barrier > 0 && since >= ticks(BARRIER_DELAY)) gain += (barrier * BARRIER_RATE) / 60;
  if (gain > 0) p.shield = Math.min(cap, p.shield + gain);
}
