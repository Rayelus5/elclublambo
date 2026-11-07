import type { EliteDef, EnemyDef } from '../content/types';
import { angleTo } from '../math/trig';
import type { Sim } from '../types';

// Spawning fauna (GDD §5.5). Behaviours live in updateEnemies (systems/enemies.ts, Task 4).

/** Multipliers from the minute and the layer (systems/director.ts). */
export interface Scale {
  hp: number;
  damage: number;
  speed: number;
}

export const NO_SCALE: Scale = Object.freeze({ hp: 1, damage: 1, speed: 1 });

const ELITE_CODE = { shielded: 1, swift: 2, volatile: 3 } as const;

/** Puts a species in the world; returns its slot, or −1 with the pool full. */
export function spawnEnemy(sim: Sim, def: EnemyDef, x: number, y: number, opts: { elite?: EliteDef; scale?: Scale } = {}): number {
  const en = sim.enemies;
  const i = en.spawn();
  if (i < 0) return -1;
  const scale = opts.scale ?? NO_SCALE;
  const elite = opts.elite;
  const e = sim.sector.elite;
  const hp = def.hp * scale.hp * (elite ? e.hp : 1);
  en.type[i] = sim.content.enemies.indexOf(def);
  en.x[i] = x;
  en.y[i] = y;
  en.px[i] = x;
  en.py[i] = y;
  en.hp[i] = hp;
  en.maxHp[i] = hp;
  en.radius[i] = def.radius * (elite ? e.radius : 1);
  en.speed[i] = def.speed * scale.speed * (elite ? elite.speed : 1);
  en.damage[i] = def.damage * scale.damage;
  en.elite[i] = elite ? ELITE_CODE[elite.id] : 0;
  en.shield[i] = elite ? hp * elite.shield : 0;
  const p = nearestProbe(sim, x, y);
  en.facing[i] = p ? angleTo(p.x - x, p.y - y) : 0;
  return i;
}

export function nearestProbe(sim: Sim, x: number, y: number) {
  let best = null;
  let bestD2 = Infinity;
  for (const p of sim.probes) {
    if (!p.alive) continue;
    const d2 = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = p;
    }
  }
  return best;
}
