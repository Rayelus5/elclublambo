import { PICKUP } from '../world/pools';
import type { HitSource, Sim } from '../types';
import { dropPickup } from './pickups';

// The damage pipeline (GDD §5.3–5.5): critical hits, elite shields, life, the hit flash, lifesteal and death with its
// drops. Elements (Task 6) and bosses (Task 8) hook in here.

export const FLASH_TICKS = 6;

/** Deals `amount` to enemy `e`; returns the damage done (shield included). Kills it at 0 life. */
export function dealDamage(sim: Sim, e: number, amount: number, src: HitSource): number {
  const en = sim.enemies;
  if (!en.alive[e] || en.fuseT[e]! > 0 || !(amount > 0)) return 0;
  const p = sim.probes[src.probe];
  let dmg = amount;
  let crit = false;
  if (p && sim.rng.combat.chance(p.stats.crit)) {
    crit = true;
    dmg *= p.stats.critDamage;
  }
  const absorbed = Math.min(en.shield[e]!, dmg);
  en.shield[e] = en.shield[e]! - absorbed;
  en.hp[e] = en.hp[e]! - (dmg - absorbed);
  en.flashT[e] = FLASH_TICKS;
  sim.events.push({ t: 'hit', x: en.x[e]!, y: en.y[e]!, amount: dmg, crit, element: src.element });
  if (p && p.alive && p.stats.lifesteal > 0) p.hp = Math.min(p.stats.maxHp, p.hp + dmg * p.stats.lifesteal);
  if (en.hp[e]! <= 0) killEnemy(sim, e, src);
  return dmg;
}

/** Death: credit, data fragments and loot; the slot is freed. */
export function killEnemy(sim: Sim, e: number, src: HitSource): void {
  const en = sim.enemies;
  const def = sim.content.enemies[en.type[e]!]!;
  const x = en.x[e]!;
  const y = en.y[e]!;
  const elite = en.elite[e]! > 0;
  const p = sim.probes[src.probe];
  sim.kills++;
  if (p) p.kills++;
  sim.events.push({ t: 'kill', x, y, enemy: def.id, elite });
  const sector = sim.sector;
  dropPickup(sim, PICKUP.xp, def.xp * (elite ? sector.elite.xp : 1), x, y);
  const luck = p ? p.stats.luck : 1;
  if (elite) {
    dropPickup(sim, PICKUP.coin, sector.elite.coins, x + 4, y);
    dropPickup(sim, PICKUP.dust, sector.elite.dust, x - 4, y);
  } else {
    if (sim.rng.loot.chance(sector.drops.coin * luck)) dropPickup(sim, PICKUP.coin, 1, x + 3, y);
    if (sim.rng.loot.chance(sector.drops.dust * luck)) dropPickup(sim, PICKUP.dust, 1, x - 3, y);
  }
  en.kill(e);
}
