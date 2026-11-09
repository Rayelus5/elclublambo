import type { StatBonus } from './systems/stats';
import type { AnomalyDef, Content, ElementId, ProbeDef, SectorDef } from './content/types';
import type { SimEvent } from './events';
import type { Rng } from './math/rng';
import type { SpatialGrid } from './world/grid';
import type { AreaPool, EnemyPool, FoeShotPool, PickupPool, PropPool, ShotPool } from './world/pools';

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
  /** Co-op: the offer the pick answers (its sequence number, mod 256); a pick for another offer is dropped. */
  offer?: number;
  /** Co-op: the player's presence (sticky): 0 here, 1 away (disconnected), 2 left the run for good. */
  presence?: number;
}

/**
 * The co-op rules of a run (multiplayer plan, phase 4), snapshotted by the server at its start like the anomaly. In
 * co-op the world never pauses: each player has `pickSeconds` to take a card (then one is taken for them); a probe at
 * 0 life falls and waits `downSeconds` to be revived by a teammate staying within `reviveRadius` for
 * `reviveSeconds`; if nobody comes it is out until the next layer. The arrays scale by the players still in the run
 * (index = players − 1), and `limits` multiplies the shared pools.
 */
export interface CoopRules {
  pickSeconds: number;
  downSeconds: number;
  reviveSeconds: number;
  reviveRadius: number;
  /** Life (fraction of max) and invulnerability (seconds) on coming back. */
  reviveHp: number;
  reviveInvuln: number;
  enemyHp: number[];
  enemyDamage: number[];
  density: number[];
  bossHp: number[];
  limits: { shots: number; areas: number; pickups: number };
}

export const DEFAULT_COOP_RULES: CoopRules = Object.freeze({
  pickSeconds: 15,
  downSeconds: 30,
  reviveSeconds: 3,
  reviveRadius: 28,
  reviveHp: 0.5,
  reviveInvuln: 2,
  enemyHp: [1, 1.5, 2, 2.5],
  enemyDamage: [1, 1.1, 1.15, 1.2],
  density: [1, 1.4, 1.75, 2.1],
  bossHp: [1, 1.8, 2.6, 3.4],
  limits: { shots: 2, areas: 2, pickups: 1.5 },
}) as CoopRules;

/** Where a probe stands in a co-op run: up, fallen (waiting for a revive), out (until the next layer), away
 * (disconnected) or left (gone for good). In solo it is always 'up' while alive. */
export type ProbeLife = 'up' | 'down' | 'out' | 'away' | 'left';

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
  /** The season's anomaly (M7d-3): an id of `content.anomalies`, snapshotted at the start; absent or null, none. */
  anomaly?: string | null;
  /** A co-op run (multiplayer plan): its rules. Absent: solo, exactly as before. */
  coop?: CoopRules;
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
  /** Co-op: the open offer's sequence number and the tick it is taken for the player. */
  offerSeq: number;
  offerUntil: number;
  /** Co-op: up, down, out, away or left; and while down, ticks left and the revive's progress (ticks). */
  life: ProbeLife;
  downT: number;
  reviveT: number;
  /** Co-op: teammates revived and times fallen (results). */
  revives: number;
  downs: number;
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
  /** The season's anomaly for this run (M7d-3), or null. */
  readonly anomaly: AnomalyDef | null;
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
  /** Breakable props of the ground, the grid that finds them and which chunks are live or broken (systems/props.ts). */
  props: PropPool;
  propGrid: SpatialGrid;
  terrain: TerrainState;
  boss: BossState | null;
  beacon: BeaconState | null;
  /** Warned blasts in the order they were laid. */
  blasts: Blast[];
  /** Coins, star dust and components picked up in each layer (index = layer − 1). */
  loot: LayerLoot[];
  kills: number;
  bossKills: number;
  events: SimEvent[];
  log: InputLog | null;
  /** Running state of later systems (director clocks, wave cursors…). */
  clocks: Record<string, number>;
  /** Co-op rules (absent in solo) and the players the current layer is scaled for. */
  coop: CoopRules | null;
  players: number;
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
  loot: LayerLoot[];
  hash: string;
}

export interface LayerLoot {
  coins: number;
  dust: number;
  components: number;
}

/** The chunks whose props are live (sorted keys) and, per chunk, a bit for each prop already broken. */
export interface TerrainState {
  live: number[];
  broken: Map<number, number>;
}
