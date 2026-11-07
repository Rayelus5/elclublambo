import type { StatBonus } from './systems/stats';
import type { Content, ElementId, ProbeDef, SectorDef } from './content/types';
import type { SimEvent } from './events';
import type { Rng } from './math/rng';
import type { SpatialGrid } from './world/grid';
import type { AreaPool, EnemyPool, FoeShotPool, PickupPool, ShotPool } from './world/pools';

/**
 * One probe's input for one tick (GDD §5.2, §5.7). `mx, my`: movement, whole numbers in [−127, 127] (keyboard: ±127;
 * a stick: quantised). `aim`: −1 automatic, else an angle step in [0, 4096). `pick`: −1, or the index of the
 * level-up option to take.
 */
export interface ProbeInput {
  mx: number;
  my: number;
  aim: number;
  pick: number;
}

export const IDLE: ProbeInput = Object.freeze({ mx: 0, my: 0, aim: -1, pick: -1 });

/** An equipped galaxy as the run sees it (the server's snapshot at run start, GDD §14.7). */
export interface RelicInput {
  id: string;
  seed: string;
  /** 0 common … 4 legendary. */
  tier: number;
  level: number;
  traits: Record<string, string>;
}

export interface SimOptions {
  /** The server's run seed (64-bit, decimal). */
  seed: string;
  content: Content;
  sector: string;
  /**
   * Each probe with its relics, its level's bonuses (one more stat source, GDD §6) and the starting-weapon variant it
   * chose (null or absent: the base weapon). The server snapshots all three at the start of the run.
   */
  probes: { probe: string; relics: RelicInput[]; bonuses?: StatBonus[]; variant?: string | null }[];
  /** Keep the input log for replays (GDD §5.7). */
  record?: boolean;
}

/** Final values after every source, cap and diminishing return (GDD §8.6). */
export interface Stats {
  maxHp: number;
  /** Units per second. */
  speed: number;
  /** Multiplier on every cooldown (≤ 1). */
  cooldown: number;
  /** Multiplier on all damage dealt. */
  damage: number;
  /** Multiplier on radii and orbits. */
  area: number;
  /** Pickup radius in units. */
  pickup: number;
  /** Extra projectiles (whole). */
  projectiles: number;
  /** Life per second. */
  regen: number;
  /** Fraction of damage taken that is ignored. */
  armor: number;
  crit: number;
  critDamage: number;
  /** Multiplier on data fragments. */
  xp: number;
  /** Multiplier on drop chances. */
  luck: number;
  /** Fraction of damage dealt that heals. */
  lifesteal: number;
  /** Multiplier on projectile speed and reach. */
  velocity: number;
  /** Multiplier on how long areas, mines, turrets, beams and puddles last. */
  duration: number;
  /** Extra pierce (whole). */
  pierce: number;
  /** Multiplier on element chance, status time and reaction damage. */
  elemental: number;
  /** Recharging shield, as a fraction of max life. */
  barrier: number;
  /** More enemies and more loot (fraction). */
  curse: number;
}

/** A level-up card. `evolve`: the evolution `id` replaces its base weapon (GDD §5.3). */
export type Offer = { kind: 'weapon' | 'passive' | 'heal' | 'evolve'; id: string; level: number };

export interface OwnedWeapon {
  id: string;
  level: number;
  /** Ticks until it fires again. */
  t: number;
  /** `echo` weapons: ticks until the repeat of the last volley (0 / absent: none pending). */
  echo?: number;
}

export interface ProbeState {
  index: number;
  def: ProbeDef;
  x: number;
  y: number;
  px: number;
  py: number;
  hp: number;
  alive: boolean;
  invulnT: number;
  /** Movement direction (angle step); kept while still. */
  facing: number;
  /** Where the probe aims: the input's angle, or the facing direction in automatic mode. */
  aim: number;
  moving: boolean;
  level: number;
  xp: number;
  xpNext: number;
  weapons: OwnedWeapon[];
  passives: { id: string; level: number }[];
  relics: RelicInput[];
  /** Bonuses from outside the run (probe level, later the lab): one more stat source. */
  upgrades: StatBonus[];
  offer: Offer[] | null;
  pendingLevels: number;
  stats: Stats;
  /** Damage absorbed before life (elliptical relics). */
  shield: number;
  kills: number;
  /** Per-probe state of later systems (relic cooldowns, buffs…). */
  fx: Record<string, number>;
}

/** Who dealt a hit (for statuses, lifesteal and kill credit). */
export interface HitSource {
  probe: number;
  weapon: string | null;
  relic: number | null;
  element: ElementId | null;
  /** Where the hit comes from (armoured fronts); the probe's position when absent. */
  x?: number;
  y?: number;
}

export type SimStatus = 'running' | 'choosing' | 'extracted' | 'dead';
export type Phase = 'waves' | 'boss' | 'beacon';

export interface BossState {
  /** Slot in the enemy pool. */
  index: number;
  def: string;
  phase: number;
  /** Ticks until the next pattern, the pattern cursor and the running pattern (spiral, charge). */
  t: number;
  cursor: number;
  active: { kind: string; t: number; a: number } | null;
}

/** A warned blast waiting to go off (systems/blasts.ts). */
export interface Blast {
  x: number;
  y: number;
  radius: number;
  damage: number;
  /** The tick it goes off. */
  at: number;
}

export interface BeaconState {
  x: number;
  y: number;
  /** Ticks left before it closes. */
  t: number;
  hold: number;
  holdNeeded: number;
  radius: number;
}

export interface InputLog {
  probes: number;
  /** Delta-free event list: [tick, probe, kind (0 move, 1 pick), a, b, c]. */
  events: number[];
}

export interface Sim {
  readonly opts: SimOptions;
  readonly content: Content;
  readonly sector: SectorDef;
  tick: number;
  status: SimStatus;
  layer: number;
  phase: Phase;
  phaseTick: number;
  rng: { spawn: Rng; combat: Rng; loot: Rng; offer: Rng; ai: Rng; relic: Rng };
  probes: ProbeState[];
  enemies: EnemyPool;
  shots: ShotPool;
  foeShots: FoeShotPool;
  pickups: PickupPool;
  areas: AreaPool;
  grid: SpatialGrid;
  boss: BossState | null;
  beacon: BeaconState | null;
  /** Warned blasts in the order they were laid. */
  blasts: Blast[];
  /** Coins and star dust picked up in each layer (index = layer − 1). */
  loot: { coins: number; dust: number }[];
  kills: number;
  bossKills: number;
  events: SimEvent[];
  log: InputLog | null;
  /** Running state of later systems (director clocks, wave cursors…). */
  clocks: Record<string, number>;
}

export interface RunSummary {
  ticks: number;
  outcome: 'running' | 'extracted' | 'dead';
  /** Deepest layer reached. */
  depth: number;
  kills: number;
  bossKills: number;
  /** Highest probe level. */
  level: number;
  loot: { coins: number; dust: number }[];
  hash: string;
}
