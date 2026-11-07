// Run content as data (GDD §13.1 bis): what the live config stores under `content`. Behaviours are code (the `kind`
// fields); every number is data. Times are in seconds, distances in world units (1 unit = 1 sprite pixel at zoom 1),
// speeds in units per second and angles in degrees.

export const ELEMENT_IDS = ['burn', 'slow', 'corrosion', 'shock', 'hack', 'leech', 'breach', 'chain', 'pure', 'prism', 'invert'] as const;
export type ElementId = (typeof ELEMENT_IDS)[number];

export const WEAPON_KINDS = ['bolt', 'nova', 'lance', 'orbit', 'trail', 'ricochet', 'drone'] as const;
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
] as const;
export type StatKey = (typeof STAT_KEYS)[number];

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
  /** Max level = levels.length (1–8). */
  levels: WeaponLevel[];
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
}

export type Behavior =
  | { kind: 'chase' }
  | { kind: 'charge'; range: number; windup: number; dashSpeed: number; dashTime: number; cooldown: number }
  | { kind: 'shooter'; range: number; cooldown: number; count: number; spread: number; bulletSpeed: number; bulletDamage: number }
  | { kind: 'armored'; arc: number; reduction: number; turnRate: number }
  | { kind: 'summoner'; cooldown: number; minion: string; count: number };

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
  | { kind: 'charge'; windup: number; dashSpeed: number; dashTime: number; damage: number };

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
  biome: 'nebula';
  boss: string;
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
  drops: { coin: number; dust: number; bossCoins: number; bossDust: number };
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

export interface RelicTuning {
  /** Magnitude by rarity tier (common → legendary). */
  tier: number[];
  level: { step: number; cap: number };
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
}
