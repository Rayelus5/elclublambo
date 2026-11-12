import type { Biome } from './compositions';
import type { MusicScene } from './engine';
import type { Layer } from './styles';

// The music of a run (plan «banda sonora», part A), from what the HUD already knows: calm in the first waves, combat
// from the second layer or at the beacon, danger with under 30 % of life or in a Núcleo's later phases; the Núcleo
// brings its own piece (the deep one its own, the rest alternating by layer); a level-up choice dims it and a pause
// ducks it. Once the run is over (extracted or down for good) it says nothing: the stinger and the results' piece take
// over. Pure, so it is tested as a table.

export interface RunMood {
  hp: number;
  maxHp: number;
  phase: 'waves' | 'boss' | 'beacon';
  layer: number;
  status: 'running' | 'choosing' | 'extracted' | 'dead';
  boss: { phase: number } | null;
}

export function runScene(m: RunMood, biome: Biome, deep: boolean, paused: boolean): Extract<MusicScene, { kind: 'run' }> | null {
  if (m.status === 'dead' || m.status === 'extracted') return null;
  const low = m.maxHp > 0 && m.hp <= m.maxHp * 0.3;
  const onBoss = m.phase === 'boss' && m.boss !== null;
  let intensity: Layer = 1;
  if (m.layer >= 2 || m.phase === 'beacon' || onBoss) intensity = 2;
  if (low || (onBoss && m.boss!.phase >= 2)) intensity = 3;
  return {
    kind: 'run',
    biome,
    boss: onBoss ? { deep, form: m.layer % 2 === 1 ? 1 : 2 } : null,
    intensity,
    choosing: m.status === 'choosing',
    paused,
  };
}

/** Whether this layer's Núcleo is the deep one (every `deepBoss.every` layers): it has its own piece. */
export const deepLayer = (sim: { layer: number; sector: { deepBoss: { every: number } | null } }): boolean => !!sim.sector.deepBoss && sim.layer % sim.sector.deepBoss.every === 0;
