import { type ElementId, ELEMENT_IDS } from '../content/types';
import { angleTo } from '../math/trig';
import type { HitSource, ProbeState, Sim } from '../types';
import { ticks } from '../version';
import { killEnemy } from './combat';
import { PROBE_RADIUS } from './probes';
import { SHOT, spawnShot } from './weapons';

// Elements (GDD §5.4, §8.3). Each relic palette gives one; relic hits apply it, and a share of weapon hits apply the
// relics' elements by turns. Statuses (burn, slow, corrosion, hack) tick here; the rest act on the hit itself.

export function elementCode(e: ElementId | null): number {
  return e ? ELEMENT_IDS.indexOf(e) + 1 : 0;
}

export function elementOf(code: number): ElementId | null {
  return code > 0 ? (ELEMENT_IDS[code - 1] ?? null) : null;
}

/** The element a relic gives (from its palette), or null. */
export function relicElement(sim: Sim, traits: Record<string, string>): ElementId | null {
  const palette = traits['palette'];
  return palette ? (sim.content.elements.palettes[palette] ?? null) : null;
}

/** The element a hit carries: prism resolves to the next of its cycle; weapon hits may proc a relic's element. */
export function resolveElement(sim: Sim, src: HitSource): ElementId | null {
  let element = src.element;
  const p = sim.probes[src.probe];
  if (!element && src.weapon !== null && p && p.relics.length > 0) {
    const own = p.relics.map((r) => relicElement(sim, r.traits)).filter((x): x is ElementId => x !== null);
    if (own.length > 0 && sim.rng.combat.chance(sim.content.relics.weaponProc * p.stats.elemental)) {
      const turn = p.fx['proc'] ?? 0;
      element = own[turn % own.length]!;
      p.fx['proc'] = turn + 1;
    }
  }
  if (element === 'prism') {
    const cycle = sim.content.elements.prism.cycle;
    const k = sim.clocks['prism'] ?? 0;
    sim.clocks['prism'] = k + 1;
    element = cycle[k % cycle.length] ?? null;
  }
  return element;
}

/** Multiplier on the hit before it lands (breach, corrosion). */
export function damageFactor(sim: Sim, e: number, element: ElementId | null): number {
  const en = sim.enemies;
  let f = 1;
  if (en.corrT[e]! > 0) f *= 1 + sim.content.elements.corrosion.bonus;
  if (element === 'breach') {
    const b = sim.content.elements.breach;
    if (en.shield[e]! > 0) f *= b.shield;
    else if (en.boss[e] || sim.content.enemies[en.type[e]!]?.behavior.kind === 'armored') f *= 1 + b.armor;
  }
  return f;
}

/** Extra critical chance and damage a hit carries (pure). */
export function critBonus(sim: Sim, element: ElementId | null): { chance: number; damage: number } {
  if (element !== 'pure') return { chance: 0, damage: 0 };
  const p = sim.content.elements.pure;
  return { chance: p.crit, damage: p.critDamage };
}

/** Damage over time and status side damage: no criticals, no elements, but shields, death and credit as usual. */
export function plainDamage(sim: Sim, e: number, amount: number, src: HitSource): void {
  const en = sim.enemies;
  if (!en.alive[e] || en.fuseT[e]! > 0 || !(amount > 0)) return;
  const absorbed = Math.min(en.shield[e]!, amount);
  en.shield[e] = en.shield[e]! - absorbed;
  en.hp[e] = en.hp[e]! - (amount - absorbed);
  if (en.hp[e]! <= 0) killEnemy(sim, e, src);
}

const near: number[] = [];

/** The `n` nearest other living, non-hacked enemies within `range` of (x, y). */
function neighbours(sim: Sim, x: number, y: number, range: number, n: number, not: number): number[] {
  const en = sim.enemies;
  const count = sim.grid.query(x, y, range + 40, near);
  const found: number[] = [];
  for (let k = 0; k < count; k++) {
    const o = near[k]!;
    if (o === not || !en.alive[o] || en.fuseT[o]! > 0 || en.hackT[o]! > 0 || found.includes(o)) continue;
    const dx = en.x[o]! - x;
    const dy = en.y[o]! - y;
    if (dx * dx + dy * dy <= range * range) found.push(o);
  }
  const d2 = (o: number) => (en.x[o]! - x) * (en.x[o]! - x) + (en.y[o]! - y) * (en.y[o]! - y);
  found.sort((a, b) => d2(a) - d2(b) || a - b);
  return found.slice(0, n);
}

/**
 * After a hit with `element` landed (`dealt` damage). `x, y`: where the enemy was (it may have died). Spreading
 * hits carry no element, so nothing chains forever.
 */
export function applyElement(sim: Sim, e: number, element: ElementId, dealt: number, x: number, y: number, src: HitSource, deal: (e: number, amount: number) => void): void {
  const en = sim.enemies;
  const t = sim.content.elements;
  const alive = en.alive[e] === 1 && en.fuseT[e] === 0;
  // The Catalyst makes statuses last longer.
  const last = (seconds: number) => ticks(seconds * (sim.probes[src.probe]?.stats.elemental ?? 1));
  switch (element) {
    case 'burn':
      if (!alive) return;
      en.burnStacks[e] = Math.min(t.burn.stacks, en.burnStacks[e]! + 1);
      en.burnDps[e] = Math.max(en.burnDps[e]!, dealt * t.burn.share);
      en.burnT[e] = last(t.burn.seconds);
      break;
    case 'slow':
      if (alive) en.slowT[e] = last(t.slow.seconds);
      break;
    case 'corrosion':
      if (alive) en.corrT[e] = last(t.corrosion.seconds);
      break;
    case 'shock':
      if (!sim.rng.combat.chance(t.shock.chance)) return;
      for (const o of neighbours(sim, x, y, t.shock.range, t.shock.targets, e)) deal(o, dealt * t.shock.share);
      break;
    case 'hack':
      if (!alive || en.boss[e] || en.elite[e]! > 0) return;
      if (sim.rng.combat.chance(t.hack.chance)) en.hackT[e] = last(t.hack.seconds);
      break;
    case 'leech': {
      const p = sim.probes[src.probe];
      if (p && p.alive) p.hp = Math.min(p.stats.maxHp, p.hp + dealt * t.leech.share);
      break;
    }
    case 'chain':
      for (const o of neighbours(sim, x, y, t.chain.range, t.chain.bounces, e)) deal(o, dealt * t.chain.share);
      break;
    case 'breach':
    case 'pure':
    case 'prism':
    case 'invert':
      break;
  }
  sim.events.push({ t: 'element', x, y, element });
}

/** Antimatter: enemy bullets that come within reach are rolled once; on success they turn back with ×power. */
export function invertNearby(sim: Sim, p: ProbeState): void {
  if (!p.alive) return;
  const t = sim.content.elements.invert;
  const fs = sim.foeShots;
  const r = t.radius + PROBE_RADIUS;
  for (let i = 0; i < fs.top; i++) {
    if (!fs.alive[i] || fs.rolled[i]) continue;
    const dx = fs.x[i]! - p.x;
    const dy = fs.y[i]! - p.y;
    if (dx * dx + dy * dy > r * r) continue;
    fs.rolled[i] = 1;
    if (!sim.rng.combat.chance(t.chance)) continue;
    const speed = Math.sqrt(fs.vx[i]! * fs.vx[i]! + fs.vy[i]! * fs.vy[i]!) * 60;
    spawnShot(sim, p, SHOT.reflected, fs.x[i]!, fs.y[i]!, angleTo(-fs.vx[i]!, -fs.vy[i]!), speed, fs.damage[i]! * t.power, {
      ttl: ticks(3),
      srcKind: 2,
      element: elementCode('invert'),
    });
    fs.kill(i);
  }
}

const HACK_HIT_SECONDS = 0.5;

/** One tick of statuses: burn damage, timers, and hacked enemies fighting for the probes. */
export function tickStatuses(sim: Sim): void {
  const en = sim.enemies;
  for (let e = 0; e < en.top; e++) {
    if (!en.alive[e] || en.fuseT[e]! > 0) continue;
    if (en.burnT[e]! > 0) {
      en.burnT[e] = en.burnT[e]! - 1;
      plainDamage(sim, e, (en.burnDps[e]! * en.burnStacks[e]!) / 60, { probe: 0, weapon: null, relic: null, element: 'burn' });
      if (!en.alive[e]) continue;
      if (en.burnT[e] === 0) {
        en.burnStacks[e] = 0;
        en.burnDps[e] = 0;
      }
    }
    if (en.slowT[e]! > 0) en.slowT[e] = en.slowT[e]! - 1;
    if (en.corrT[e]! > 0) en.corrT[e] = en.corrT[e]! - 1;
    if (en.hackT[e]! > 0) {
      en.hackT[e] = en.hackT[e]! - 1;
      hackedTurn(sim, e);
    }
  }
}

function hackedTurn(sim: Sim, e: number): void {
  const en = sim.enemies;
  const [prey] = neighbours(sim, en.x[e]!, en.y[e]!, 400, 1, e);
  if (prey === undefined) return;
  const dx = en.x[prey]! - en.x[e]!;
  const dy = en.y[prey]! - en.y[e]!;
  const d = Math.sqrt(dx * dx + dy * dy);
  const reach = en.radius[e]! + en.radius[prey]!;
  if (d > reach) {
    const stepLen = Math.min(en.speed[e]! / 60, d - reach);
    en.x[e] = en.x[e]! + (dx / d) * stepLen;
    en.y[e] = en.y[e]! + (dy / d) * stepLen;
    en.facing[e] = angleTo(dx, dy);
  }
  if (en.hitT[e]! > 0) en.hitT[e] = en.hitT[e]! - 1;
  if (en.hitT[e] === 0 && d <= reach + 1) {
    en.hitT[e] = ticks(HACK_HIT_SECONDS);
    plainDamage(sim, prey, en.damage[e]!, { probe: 0, weapon: null, relic: null, element: 'hack' });
  }
}
