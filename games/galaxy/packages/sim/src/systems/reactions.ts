import type { ElementId, ReactionDef } from '../content/types';
import type { HitSource, Sim } from '../types';
import { ticks } from '../version';
import { dealDamage } from './combat';
import { elementCode, elementOf } from './elements';
import { hitArea, nearestEnemies } from './weapons';

// Reactions (GDD §5.4, plan ruling 4). An elemental hit leaves its mark on the enemy for a few seconds; a hit of
// another element on a marked enemy sets off the reaction of that pair, if there is one, and consumes the mark.
// Reaction damage carries no element and no weapon, so it never reacts or chains again, and every enemy waits a
// moment between reactions (§8.6). Pure damage and antimatter leave no mark; prism has already been resolved.

/** Hacking spread by a virus lasts this long. */
const VIRUS_SECONDS = 2;
const NO_MARK: readonly ElementId[] = ['pure', 'invert', 'prism'];

function reactionFor(sim: Sim, a: ElementId, b: ElementId): ReactionDef | undefined {
  return sim.content.elements.reactions.find((r) => (r.pair[0] === a && r.pair[1] === b) || (r.pair[0] === b && r.pair[1] === a));
}

/** After an elemental hit (`dealt` damage) on enemy `e` at (x, y): react with its mark, or mark it. */
export function react(sim: Sim, e: number, element: ElementId, dealt: number, x: number, y: number, src: HitSource): void {
  const en = sim.enemies;
  if (NO_MARK.includes(element) || !en.alive[e] || en.fuseT[e]! > 0) return;
  // Bosses and elites cannot be hacked, so hacking neither marks them nor reacts on them.
  if (element === 'hack' && (en.boss[e] || en.elite[e]! > 0)) return;
  const tuning = sim.content.elements.marks;
  const marked = en.markT[e]! > 0 ? elementOf(en.mark[e]!) : null;
  if (marked && marked !== element && en.reactT[e] === 0) {
    const r = reactionFor(sim, marked, element);
    if (r) {
      en.mark[e] = 0;
      en.markT[e] = 0;
      en.reactT[e] = Math.max(1, ticks(tuning.cooldown));
      sim.events.push({ t: 'reaction', id: r.id, x, y });
      apply(sim, r, e, dealt * (sim.probes[src.probe]?.stats.elemental ?? 1), x, y, src.probe);
      return;
    }
  }
  en.mark[e] = elementCode(element);
  en.markT[e] = Math.max(1, ticks(tuning.seconds));
}

function apply(sim: Sim, r: ReactionDef, e: number, power: number, x: number, y: number, probe: number): void {
  const en = sim.enemies;
  const t = sim.content.elements;
  const src: HitSource = { probe, weapon: null, relic: null, element: null, x, y };
  const fx = r.effect;
  switch (fx.kind) {
    case 'chain':
      for (const o of nearestEnemies(sim, x, y, fx.range, fx.targets + 1, (o) => o === e).slice(0, fx.targets)) dealDamage(sim, o, power * fx.share, src);
      break;
    case 'explode':
      hitArea(sim, x, y, fx.radius, power * fx.share, src);
      break;
    case 'shatter':
      if (en.alive[e]) {
        en.vulnBonus[e] = Math.max(en.vulnBonus[e]!, fx.bonus);
        en.vulnT[e] = Math.max(en.vulnT[e]!, ticks(fx.seconds));
        dealDamage(sim, e, power * fx.share, src);
      }
      break;
    case 'stun':
      if (!en.alive[e]) break;
      if (en.boss[e]) {
        // A boss is stunned shorter and at most once every few seconds: never stun-locked (§8.6).
        if (sim.tick < (sim.clocks['bossStunReady'] ?? 0)) break;
        sim.clocks['bossStunReady'] = sim.tick + ticks(t.marks.bossStunEvery);
        en.freezeT[e] = Math.max(en.freezeT[e]!, ticks(fx.seconds * t.marks.bossStun));
      } else en.freezeT[e] = Math.max(en.freezeT[e]!, ticks(fx.seconds));
      break;
    case 'spread':
      for (const o of nearestEnemies(sim, x, y, fx.range, fx.targets + 1, (o) => o === e).slice(0, fx.targets)) {
        for (const status of fx.statuses) {
          if (status === 'burn') {
            en.burnT[o] = Math.max(en.burnT[o]!, ticks(t.burn.seconds));
            en.burnStacks[o] = Math.max(en.burnStacks[o]!, 1);
            en.burnDps[o] = Math.max(en.burnDps[o]!, power * t.burn.share);
          } else if (status === 'corrosion') {
            en.corrT[o] = Math.max(en.corrT[o]!, ticks(t.corrosion.seconds));
          } else if (!en.boss[o] && en.elite[o] === 0) {
            en.hackT[o] = Math.max(en.hackT[o]!, ticks(VIRUS_SECONDS));
          }
        }
      }
      break;
    case 'drain': {
      const dealt = en.alive[e] ? dealDamage(sim, e, power * fx.share, src) : 0;
      const p = sim.probes[probe];
      if (p && p.alive) p.hp = Math.min(p.stats.maxHp, p.hp + dealt * fx.heal);
      break;
    }
  }
}
