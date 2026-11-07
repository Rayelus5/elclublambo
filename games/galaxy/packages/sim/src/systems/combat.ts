import { PICKUP } from '../world/pools';
import type { HitSource, Sim } from '../types';
import { ticks } from '../version';
import { scaleAt } from './director';
import { ELITE_CODE, hitsFront, spawnEnemy } from './enemies';
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
  const def = sim.content.enemies[en.type[e]!];
  if (def && def.behavior.kind === 'armored' && !en.boss[e]) {
    const ox = src.x ?? (p ? p.x : en.x[e]!);
    const oy = src.y ?? (p ? p.y : en.y[e]!);
    if (hitsFront(sim, e, ox, oy)) dmg *= 1 - def.behavior.reduction;
  }
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
