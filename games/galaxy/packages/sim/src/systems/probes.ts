import { angleTo } from '../math/trig';
import { IDLE, type ProbeInput, type ProbeState, type Sim } from '../types';
import { ticks } from '../version';

// Probes (GDD §5.2, §6): movement from per-tick inputs, contact damage with half a second of invulnerability, shield,
// regeneration, and death. The run ends when every probe is down.

export const PROBE_RADIUS = 7;
export const INVULN_SECONDS = 0.5;

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

/** Damage to a probe: armor first, then the shield, then life. Starts the invulnerability window. */
export function hurtProbe(sim: Sim, p: ProbeState, amount: number): void {
  if (!p.alive || p.invulnT > 0 || amount <= 0) return;
  let dmg = amount * (1 - p.stats.armor);
  const absorbed = Math.min(p.shield, dmg);
  p.shield -= absorbed;
  dmg -= absorbed;
  p.hp -= dmg;
  p.invulnT = ticks(INVULN_SECONDS);
  p.fx['lastHurt'] = sim.tick;
  sim.events.push({ t: 'hurt', probe: p.index, amount: dmg + absorbed });
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
      if (!en.alive[e] || en.hackT[e]! > 0 || en.fuseT[e]! > 0) continue;
      const dx = en.x[e]! - p.x;
      const dy = en.y[e]! - p.y;
      const r = PROBE_RADIUS + en.radius[e]!;
      if (dx * dx + dy * dy < r * r) {
        hurtProbe(sim, p, en.damage[e]!);
        break;
      }
    }
  }
}

export function tickProbes(sim: Sim): void {
  for (const p of sim.probes) {
    if (!p.alive) continue;
    if (p.invulnT > 0) p.invulnT--;
    if (p.stats.regen > 0) p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.regen / 60);
  }
}
