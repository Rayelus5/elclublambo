// Run content as data (GDD §13.1 bis): what the live config stores under `content`. Behaviours are code (the `kind`
// fields); every number is data. Times are in seconds, distances in world units (1 unit = 1 sprite pixel at zoom 1),
// speeds in units per second and angles in degrees.

export const ELEMENT_IDS = ['burn', 'slow', 'corrosion', 'shock', 'hack', 'leech', 'breach', 'chain', 'pure', 'prism', 'invert'] as const;
export type ElementId = (typeof ELEMENT_IDS)[number];

export const WEAPON_KINDS = [
  'bolt',
  'nova',
  'lance',
  'orbit',
  'trail',
  'ricochet',
  'drone',
  'beam',
  'cone',
  'radial',
  'homing',
  'mine',
  'boomerang',
  'field',
  'strike',
  'turret',
] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];

export const STAT_KEYS = [
  'maxHp',
  'speed',
  'cooldown',
  'damage',
  'area',
  'pickup',
  'projectiles',
  'regen',
  'armor',
  'crit',
  'critDamage',
  'xp',
  'luck',
  'lifesteal',
  'velocity',
  'duration',
  'pierce',
  'elemental',
  'barrier',
  'curse',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/** What an evolved weapon adds to its kind (plan ruling 3): one generic trait each. */
export const SPECIALS = ['split', 'echo', 'vortex', 'pierceAll', 'chain'] as const;
export type Special = (typeof SPECIALS)[number];

export const FAMILY_IDS = ['blades', 'ray', 'shield', 'lens', 'chaos', 'aura', 'scout', 'echo'] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];

export const PHENOMENON_IDS = [
  'supernova',
  'satellite_galaxy',
  'globular_cluster',
  'comet',
  'relativistic_jets',
  'pulsar',
  'einstein_ring',
  'anomaly',
] as const;
export type PhenomenonId = (typeof PHENOMENON_IDS)[number];

export const ENEMY_FAMILIES = ['swarm', 'charger', 'shooter', 'splitter', 'armored', 'healer', 'summoner'] as const;

/** The look of a sector's ground (GDD §5.5): drawn by the arena, no collision. */
export const BIOMES = ['nebula', 'ice', 'reef', 'forge', 'rift'] as const;
export type BiomeId = (typeof BIOMES)[number];
export type EnemyFamily = (typeof ENEMY_FAMILIES)[number];

/** One level of a weapon. Fields a weapon kind does not use are 0. */
export interface WeaponLevel {
  damage: number;
  cooldown: number;
  count: number;
  pierce: number;
  speed: number;
  area: number;
  duration: number;
  range: number;
  bounces: number;
  knockback: number;
  interval: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  kind: WeaponKind;
  icon: string;
  description: string;
  /** Max level = levels.length (1–8); an evolution has exactly one. */
  levels: WeaponLevel[];
  /** An element every hit of the weapon carries. */
  element?: ElementId | null;
  special?: Special | null;
  /**
   * An evolution (GDD §5.3): offered once `from` is at its max level and the probe has the passive (any level) or a
   * relic with the element. It takes the base weapon's slot and is never offered as a new weapon.
   */
  evolution?: { from: string; requires: { passive: string } | { element: ElementId } };
  /**
   * A starting-weapon variant (GDD §6, M4b-1): a sidegrade of a base weapon that its probe unlocks at level 4 or 8 and
   * may start the run with. Never offered as a new weapon; it evolves into its base's evolution.
   */
  variant?: { of: string; unlockAt: 4 | 8 };
}

export interface PassiveDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  stat: StatKey;
  /** Total contribution to `stat` at each level. */
  levels: number[];
}

export interface ProbeDef {
  id: string;
  name: string;
  sprite: string;
  description: string;
  hp: number;
  speed: number;
  pickup: number;
  armor: number;
  regen: number;
  weapon: string;
  bonus: Partial<Record<StatKey, number>>;
  /** Its quirk (GDD §6, «una peculiaridad»): what it does is code (systems/quirks.ts), the numbers are data. */
  quirk: Quirk | null;
}

export type Quirk =
  | { kind: 'magnet'; every: number; radius: number }
  | { kind: 'thorns'; share: number }
  | { kind: 'dash'; every: number; distance: number; invuln: number }
  | { kind: 'overwatch'; drones: number }
  | { kind: 'second-wind'; hp: number }
  | { kind: 'prism-touch'; chance: number; cycle: ElementId[] }
  | { kind: 'afterburner'; bonus: number; seconds: number }
  | { kind: 'salvage'; kills: number };

export type Behavior =
  | { kind: 'chase' }
  | { kind: 'charge'; range: number; windup: number; dashSpeed: number; dashTime: number; cooldown: number }
  | { kind: 'shooter'; range: number; cooldown: number; count: number; spread: number; bulletSpeed: number; bulletDamage: number }
  | { kind: 'armored'; arc: number; reduction: number; turnRate: number; weakTo?: ElementId }
  | { kind: 'summoner'; cooldown: number; minion: string; count: number }
  /** Circles the probe at `radius`, turning `turn` °/s; every `every` s dives straight for `diveTime`. */
  | { kind: 'orbit'; radius: number; turn: number; every: number; diveSpeed: number; diveTime: number }
  /** Keeps `keep` u from the probe and every `cooldown` s heals or shields (× max life) the allies in `range`. */
  | { kind: 'support'; effect: 'heal' | 'shield'; amount: number; range: number; cooldown: number; keep: number }
  /** Within `range`, marks a point `offset` u behind the probe, waits `windup` s and jumps there. */
  | { kind: 'blink'; range: number; offset: number; windup: number; cooldown: number }
  /** Stays at `range`, aims a warned line for `windup` s and fires one fast bullet along it. */
  | { kind: 'lancer'; range: number; windup: number; cooldown: number; bulletSpeed: number; bulletDamage: number };

export interface EnemyDef {
  id: string;
  name: string;
  family: EnemyFamily;
  sprite: string;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  xp: number;
  behavior: Behavior;
  split?: { into: string; count: number };
}

export interface EliteDef {
  id: 'shielded' | 'swift' | 'volatile';
  name: string;
  /** Shield as a fraction of the elite's life (0: none). */
  shield: number;
  /** Speed multiplier (1: unchanged). */
  speed: number;
  explode: { radius: number; damage: number; delay: number } | null;
}

export type BossPattern =
  | { kind: 'radial'; count: number; speed: number; damage: number }
  | { kind: 'aimed'; count: number; spread: number; speed: number; damage: number }
  | { kind: 'spiral'; duration: number; every: number; step: number; speed: number; damage: number }
  | { kind: 'summon'; enemy: string; count: number }
  | { kind: 'charge'; windup: number; dashSpeed: number; dashTime: number; damage: number }
  /** A ring of `count` with a `gap` ° hole in a random direction. */
  | { kind: 'wall'; count: number; gap: number; speed: number; damage: number }
  /** `count` warned blasts within `spread` u of the probe, exploding after `delay` s. */
  | { kind: 'mines'; count: number; spread: number; radius: number; delay: number; damage: number }
  /** Vanishes for `windup` s and comes back `offset` u from the probe with a ring of `count`. */
  | { kind: 'blink'; offset: number; windup: number; count: number; speed: number; damage: number };

export interface BossPhase {
  /** The phase starts when life falls to this fraction (the first phase: 1). */
  below: number;
  interval: number;
  telegraph: number;
  speed: number;
  patterns: BossPattern[];
}

export interface BossDef {
  id: string;
  name: string;
  title: string;
  sprite: string;
  hp: number;
  radius: number;
  speed: number;
  damage: number;
  xp: number;
  phases: BossPhase[];
  scaling: { hpPerLayer: number; damagePerLayer: number };
}

export interface SectorDef {
  id: string;
  name: string;
  description: string;
  biome: BiomeId;
  boss: string;
  /** Every `every` layers (4, 8…) this Core comes instead of `boss` (null: never). */
  deepBoss: { boss: string; every: number } | null;
  /** A season sector (GDD §13.1): open only while it is the live config's season. */
  season: boolean;
  layerSeconds: number;
  beacon: { seconds: number; hold: number; radius: number; distance: number };
  /** `from`: second of layer 1 from which the species appears (from layer 2 on, all appear from the start). */
  spawns: { enemy: string; from: number; weight: number; group: [number, number] }[];
  waves: { at: number; kind: 'ring' | 'burst'; enemy: string; count: number }[];
  /** Groups per second: base + perMinute · minutes, up to max; at most `cap` alive; × bossFactor during the boss. */
  density: { base: number; perMinute: number; max: number; cap: number; bossFactor: number };
  scaling: {
    hpPerMinute: number;
    damagePerMinute: number;
    hpPerLayer: number;
    damagePerLayer: number;
    speedPerLayer: number;
    eliteBase: number;
    elitePerMinute: number;
    eliteMax: number;
  };
  elite: { hp: number; radius: number; xp: number; coins: number; dust: number };
  /** Drop chances per kill (coin, dust, repair kit) and the boss chest; a repair kit heals repairHeal of max life. */
  drops: { coin: number; dust: number; repair: number; repairHeal: number; bossCoins: number; bossDust: number };
}

/** What a reaction does (GDD §5.4); shares are of the hit that triggered it, × (1 + elemental). */
export type ReactionEffect =
  | { kind: 'chain'; targets: number; range: number; share: number }
  | { kind: 'explode'; radius: number; share: number }
  | { kind: 'shatter'; bonus: number; seconds: number; share: number }
  | { kind: 'stun'; seconds: number }
  | { kind: 'spread'; range: number; targets: number; statuses: ('burn' | 'corrosion' | 'hack')[] }
  | { kind: 'drain'; share: number; heal: number };

export interface ReactionDef {
  id: string;
  name: string;
  /** The two elements, in any order (one reaction per pair). */
  pair: [ElementId, ElementId];
  effect: ReactionEffect;
}

export interface ElementTuning {
  /** Palette trait value → element (GDD §8.3). */
  palettes: Record<string, ElementId>;
  burn: { share: number; seconds: number; stacks: number };
  slow: { factor: number; seconds: number };
  corrosion: { bonus: number; seconds: number };
  shock: { chance: number; targets: number; share: number; range: number };
  hack: { chance: number; seconds: number };
  leech: { share: number };
  breach: { shield: number; armor: number };
  chain: { bounces: number; share: number; range: number };
  pure: { crit: number; critDamage: number };
  prism: { cycle: ElementId[] };
  invert: { radius: number; chance: number; power: number };
  /** Element marks (plan ruling 4): how long a mark lasts, the per-enemy wait between reactions, stun on bosses. */
  marks: { seconds: number; cooldown: number; bossStun: number; bossStunEvery: number };
  reactions: ReactionDef[];
}

export interface FamilyTuning {
  blades: { damage: number; radius: number; interval: number; speed: number };
  ray: { damage: number; cooldown: number; pierce: number; speed: number; cone: number; range: number };
  shield: { shield: number; recharge: number };
  lens: { crit: number; critDamage: number };
  chaos: {
    cooldown: number;
    nova: { damage: number; radius: number };
    bolts: { count: number; damage: number; speed: number };
    slowField: { radius: number; seconds: number };
    haste: { bonus: number; seconds: number };
  };
  aura: { damage: number; interval: number; radius: number; cone: number; coneRadius: number };
  scout: { pickup: number; speed: number };
  echo: { share: number };
}

export interface PhenomenonTuning {
  supernova: { cooldown: number; damage: number; radius: number };
  satellite_galaxy: { cooldown: number; damage: number; range: number; speed: number };
  globular_cluster: { count: number; damage: number; radius: number; speed: number; interval: number };
  comet: { cooldown: number; distance: number; seconds: number; damage: number };
  relativistic_jets: { cooldown: number; damage: number; pierce: number; speed: number };
  pulsar: { cooldown: number; radius: number; damage: number };
  einstein_ring: { projectiles: number };
  anomaly: { cooldown: number; blink: number; freezeRadius: number; freezeSeconds: number; strikeDamage: number; strikeCount: number };
}

/** A relic set's bonus: stat bonuses for the probe, a magnitude factor and a background factor for its members. */
export interface SetBonus {
  stats?: { stat: StatKey; value: number }[];
  magnitude?: number;
  background?: number;
}

/** Relic sets (GDD §8.3, «Conjunto»): the same trait on 2–3 relics, or a galaxy type with a phenomenon. */
export type RelicSetDef =
  | {
      id: string;
      name: string;
      description: string;
      kind: 'same';
      trait: 'palette' | 'galaxy_type' | 'background' | 'core';
      /** Ascending counts; the highest reached applies. */
      tiers: { count: 2 | 3; bonus: SetBonus }[];
    }
  | { id: string; name: string; description: string; kind: 'combo'; type: string; phenomenon: string; bonus: SetBonus };

export interface RelicTuning {
  /** Magnitude by rarity tier (common → legendary). */
  tier: number[];
  level: { step: number; cap: number };
  /**
   * Stacking (GDD §8.6, M4c-1): from the `from`-th relic of the same family on (in slot order), each one's magnitude is
   * `decay` times the one before; the first ones are whole.
   */
  stacking: { from: number; decay: number };
  size: Record<string, number>;
  core: Record<string, number>;
  density: Record<string, number>;
  /** Chance that a weapon hit applies the element of an equipped relic. */
  weaponProc: number;
  families: FamilyTuning;
  phenomena: PhenomenonTuning;
  quasar: { cooldown: number; damage: number; pierce: number; speed: number };
  double: { delay: number };
  backgrounds: Record<string, { stat: StatKey | 'vision'; value: number }>;
  sets: RelicSetDef[];
}

/**
 * A season's global anomaly (GDD §13.1; M7d-3): a rule that changes every run while its season is open. Multipliers on
 * the enemies' life, damage and speed, on how many arrive, on elite chance and on data fragments; and, optionally,
 * contagion: an enemy that dies corroded corrodes the others near it.
 */
export interface AnomalyDef {
  id: string;
  name: string;
  description: string;
  enemyHp: number;
  enemyDamage: number;
  enemySpeed: number;
  spawn: number;
  elite: number;
  xp: number;
  contagion: { radius: number; seconds: number } | null;
}

export interface Content {
  probes: ProbeDef[];
  weapons: WeaponDef[];
  passives: PassiveDef[];
  enemies: EnemyDef[];
  elites: EliteDef[];
  bosses: BossDef[];
  sectors: SectorDef[];
  elements: ElementTuning;
  relics: RelicTuning;
  xp: { base: number; linear: number; quad: number };
  caps: Record<StatKey, number>;
  crit: { chance: number; damage: number };
  arena: { viewW: number; viewH: number; margin: number; despawn: number };
  limits: { weapons: number; passives: number; enemies: number; shots: number; foeShots: number; pickups: number; areas: number };
  anomalies: AnomalyDef[];
}
