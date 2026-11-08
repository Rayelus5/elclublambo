import { PICKUP } from '../world/pools';
import type { HitSource, Sim } from '../types';
import { ticks } from '../version';
import { curseOf, scaleAt } from './director';
import { ELITE_CODE, hitsFront, spawnEnemy } from './enemies';
import { applyElement, critBonus, damageFactor, resolveElement } from './elements';
import { onBossDown } from './layers';
import { bossAway } from './boss';
import { react } from './reactions';
import { dropPickup } from './pickups';
import { onKill } from './quirks';
import { enemiesNear } from './weapons';

// The damage pipeline (GDD §5.3–5.5): critical hits, elite shields, life, the hit flash, lifesteal and death with its
// drops. Elements (Task 6) and bosses (Task 8) hook in here.

export const FLASH_TICKS = 6;

/** After a hit has landed (systems/arsenal.ts: `chain` evolutions). */
export const combatHooks: { afterHit: (sim: Sim, e: number, dealt: number, x: number, y: number, src: HitSource) => void } = { afterHit: () => {} };

/** Deals `amount` to enemy `e`; returns the damage done (shield included). Kills it at 0 life. */
export function dealDamage(sim: Sim, e: number, amount: number, src: HitSource): number {
  const en = sim.enemies;
  if (!en.alive[e] || en.fuseT[e]! > 0 || !(amount > 0) || bossAway(sim, e)) return 0;
  const p = sim.probes[src.probe];
  const element = resolveElement(sim, src);
  let dmg = amount;
  const def = sim.content.enemies[en.type[e]!];
  // Armour gives from behind, to corrosion or breach, and to the one element it is weak to (GDD §5.5).
  if (def && def.behavior.kind === 'armored' && !en.boss[e] && en.corrT[e] === 0 && en.vulnT[e] === 0 && element !== def.behavior.weakTo) {
    const ox = src.x ?? (p ? p.x : en.x[e]!);
    const oy = src.y ?? (p ? p.y : en.y[e]!);
    if (hitsFront(sim, e, ox, oy)) dmg *= 1 - def.behavior.reduction;
  }
  dmg *= damageFactor(sim, e, element);
  let crit = false;
  if (p) {
    // Pure damage adds to the critical stats, still within their caps (GDD §8.6).
    const bonus = critBonus(sim, element);
    const caps = sim.content.caps;
    if (sim.rng.combat.chance(Math.min(p.stats.crit + bonus.chance, Math.max(p.stats.crit, caps.crit)))) {
      crit = true;
      dmg *= Math.min(p.stats.critDamage + bonus.damage, Math.max(p.stats.critDamage, sim.content.crit.damage + caps.critDamage));
    }
  }
  const absorbed = Math.min(en.shield[e]!, dmg);
  en.shield[e] = en.shield[e]! - absorbed;
  en.hp[e] = en.hp[e]! - (dmg - absorbed);
  en.flashT[e] = FLASH_TICKS;
  const x = en.x[e]!;
  const y = en.y[e]!;
  sim.events.push({ t: 'hit', x, y, amount: dmg, crit, element });
  if (p && p.alive && p.stats.lifesteal > 0) p.hp = Math.min(p.stats.maxHp, p.hp + dmg * p.stats.lifesteal);
  if (en.hp[e]! <= 0) killEnemy(sim, e, src);
  if (element) {
    applyElement(sim, e, element, dmg, x, y, src, (o, amt) => {
      dealDamage(sim, o, amt, { probe: src.probe, weapon: null, relic: src.relic, element: null, x, y });
    });
    react(sim, e, element, dmg, x, y, src);
  }
  combatHooks.afterHit(sim, e, dmg, x, y, src);
  return dmg;
}

/** Death: credit, data fragments and loot; the slot is freed. */
export function killEnemy(sim: Sim, e: number, src: HitSource): void {
  const en = sim.enemies;
  if (en.boss[e]) {
    onBossDown(sim, e, src);
    return;
  }
  const def = sim.content.enemies[en.type[e]!]!;
  const x = en.x[e]!;
  const y = en.y[e]!;
  const elite = en.elite[e]! > 0;
  const p = sim.probes[src.probe];
  sim.kills++;
  if (p) {
    p.kills++;
    onKill(sim, p, x, y);
  }
  sim.events.push({ t: 'kill', x, y, enemy: def.id, elite });
  const sector = sim.sector;
  dropPickup(sim, PICKUP.xp, def.xp * (elite ? sector.elite.xp : 1) * (sim.anomaly ? sim.anomaly.xp : 1), x, y);
  // Contagion (M7d-3): an enemy that dies corroded corrodes the others near it.
  const spread = sim.anomaly?.contagion;
  if (spread && sim.enemies.corrT[e]! > 0) {
    const t = ticks(spread.seconds);
    for (const o of enemiesNear(sim, x, y, spread.radius)) {
      if (o !== e && sim.enemies.alive[o] && sim.enemies.corrT[o]! < t) sim.enemies.corrT[o] = t;
    }
  }
  const luck = (p ? p.stats.luck : 1) * (1 + curseOf(sim));
  if (elite) {
    dropPickup(sim, PICKUP.coin, sector.elite.coins, x + 4, y);
    dropPickup(sim, PICKUP.dust, sector.elite.dust, x - 4, y);
    dropPickup(sim, PICKUP.repair, 1, x, y + 4);
  } else {
    if (sim.rng.loot.chance(sector.drops.coin * luck)) dropPickup(sim, PICKUP.coin, 1, x + 3, y);
    if (sim.rng.loot.chance(sector.drops.dust * luck)) dropPickup(sim, PICKUP.dust, 1, x - 3, y);
    if (sim.rng.loot.chance(sector.drops.repair * (1 + curseOf(sim)))) dropPickup(sim, PICKUP.repair, 1, x, y + 3);
  }
  if (def.split) {
    const child = sim.content.enemies.find((c) => c.id === def.split!.into);
    if (child) {
      const scale = scaleAt(sim);
      for (let k = 0; k < def.split.count; k++) spawnEnemy(sim, child, x + (k - (def.split.count - 1) / 2) * 8, y + (k % 2 === 0 ? -3 : 3), { scale });
    }
  }
  if (en.elite[e] === ELITE_CODE.volatile) {
    // The corpse lingers as a warning, then blows up (systems/enemies.ts).
    const blast = sim.content.elites.find((x) => x.id === 'volatile')?.explode;
    if (blast) {
      en.fuseT[e] = Math.max(1, ticks(blast.delay));
      en.hp[e] = 0;
      sim.events.push({ t: 'telegraph', kind: 'explode', x, y, angle: 0, ticks: en.fuseT[e]!, radius: blast.radius });
      return;
    }
  }
  en.kill(e);
}
