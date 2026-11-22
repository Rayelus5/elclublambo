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
  // The November arsenal (Nov plan B3, systems/arsenal-nov.ts).
  'harpoon',
  'sling',
  'decoy',
  'lighthouse',
  'mortar',
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
  // The November passives (Nov plan B2): content published before them gets their caps by default.
  'evasion',
  'bossDamage',
  'execute',
  'knockback',
  'movingDamage',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
/** Stats added after content was first published (Nov plan B2): their caps default, so older content still parses. */
export const LATE_STATS = ['evasion', 'bossDamage', 'execute', 'knockback', 'movingDamage'] as const satisfies readonly StatKey[];

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
  /**
   * Spark's agile dash (owner's plan 2026-11-13; systems/dash.ts): `charges` more than every probe's, each back after
   * `recharge` seconds, `pause` seconds between two, `invuln` seconds of invulnerability after it. `every` and
   * `distance` were its old automatic jump (a hit dodged every so often): still read, no longer used.
   */
  | { kind: 'dash'; invuln: number; charges: number; recharge: number; pause: number; every?: number; distance?: number }
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
  /** Its Códice text (P8, 2026-11-16); absent: the game's own. */
  lore?: string;
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
  /**
   * A blast `delay` s after it dies, within `radius`: `damage` (scaled like the enemy's), never taking more than `1 - keep`
   * of the life a probe has (the owner, 2026-11-14: it hurts, but never kills on its own).
   */
  explode: { radius: number; damage: number; delay: number; keep: number } | null;
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
  | { kind: 'blink'; offset: number; windup: number; count: number; speed: number; damage: number }
  /**
   * Nov plan B4. A line marked at the probe for `windup` s, then a beam `length` u long and `width` u wide that burns for
   * `duration` s while it turns `sweep` ° to the side its warning shows.
   */
  | { kind: 'laser'; windup: number; duration: number; sweep: number; length: number; width: number; damage: number }
  /**
   * Nov plan B4. A ring of `count` marked `radius` u around the probe for `delay` s that then closes in at `speed`, with a
   * `gap` ° way out; the bullets die at its centre.
   */
  | { kind: 'closing'; count: number; radius: number; gap: number; delay: number; speed: number; damage: number }
  /**
   * Nov plan B4. A walking barrage: `count` warned blasts in a line towards the probe, `spacing` u apart from the Core;
   * the first goes off after `delay` s and each next one `step` s later.
   */
  | { kind: 'barrage'; count: number; spacing: number; radius: number; delay: number; step: number; damage: number };

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
  /** Its Códice text and PERKINS's line when it first shows up (P8, 2026-11-16); absent: the game's own. */
  lore?: string;
  radio?: string;
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
  /** The Core of layer 1, and the one the hangar shows. */
  boss: string;
  /**
   * Nov plan B4: the Core's forms in turn, one per layer (the deep Core's layers do not count), starting with `boss`.
   * Absent (content published before): only `boss`.
   */
  bossCycle?: string[];
  /**
   * Every `every` layers (4, 8…) this Core comes instead of `boss` (null: never). `cycle` (Nov plan B4): its forms in turn,
   * one per time it comes, starting with `boss`; absent: only `boss`.
   */
  deepBoss: { boss: string; every: number; cycle?: string[] } | null;
  /** A season sector (GDD §13.1): open only while it is the live config's season. */
  season: boolean;
  /**
   * Its Códice text, PERKINS's line on the first run in it and its own names for the hazards (P8, 2026-11-16); absent:
   * the game's own.
   */
  lore?: string;
  radio?: string;
  hazardNames?: { meteors?: string; storm?: string; well?: string };
  /** Open beta: multiplies its enemies' (and its Core's) life and their damage; 1 for content published before. */
  enemyHp: number;
  enemyDamage: number;
  /**
   * Multiplies its Núcleos' damage (review B, I2): rising from the first sector to the season's. Apart from
   * `enemyDamage`, which is tuned together with the fauna's growth by the minute. 1 for content published before.
   */
  coreDamage: number;
  layerSeconds: number;
  beacon: { seconds: number; hold: number; radius: number; distance: number };
  /** `from`: second of layer 1 from which the species appears (from layer 2 on, all appear from the start). */
  spawns: { enemy: string; from: number; weight: number; group: [number, number] }[];
  waves: { at: number; kind: 'ring' | 'burst'; enemy: string; count: number }[];
  /** Groups per second: base + perMinute · minutes, up to max; at most `cap` alive; × bossFactor during the boss. */
  density: { base: number; perMinute: number; max: number; cap: number; bossFactor: number; perLayer: number };
  /**
   * The swarm family kept in check (2026-11-16): its groups stop while `cap` of it are alive (0: no limit) and, from
   * minute `fadeFrom` of the run, their weight falls by `fadePerMinute` a minute down to `fadeFloor`.
   */
  swarm: { cap: number; fadeFrom: number; fadePerMinute: number; fadeFloor: number };
  scaling: {
    hpPerMinute: number;
    damagePerMinute: number;
    hpPerLayer: number;
    damagePerLayer: number;
    speedPerLayer: number;
    eliteBase: number;
    elitePerMinute: number;
    eliteMax: number;
    /** Extra life per level of the team's highest probe past `levelFrom`, compounding: × (1 + hpPerLevel)^(level − levelFrom). */
    hpPerLevel: number;
    /** The level the life per level starts counting from (1: from the first level up). */
    levelFrom: number;
    /** The Núcleos' own, linear: × (1 + coreHpPerLevel × (level − levelFrom)) past `levelFrom`. */
    coreHpPerLevel: number;
    /** Every Núcleo of a run has at least (1 + coreRise) × the life of the one before (0: off). */
    coreRise: number;
    /** The most the life per level multiplies, however high the level (1000: no ceiling in practice). */
    hpLevelMax: number;
    /** Minute of the run the fauna's life growth freezes at its value then (the truce, 2026-11-18). */
    hpHoldFrom: number;
    /** Minute the frozen life starts growing again (≤ hpHoldFrom: no truce). */
    hpHoldUntil: number;
    /** From hpHoldUntil on, the minutes the fauna's life takes to double. */
    hpDoubleEvery: number;
    /** A fixed ceiling on the frozen life multiplier (0: none, only the freeze). */
    hpHoldMax: number;
  };
  elite: { hp: number; radius: number; xp: number; coins: number; dust: number };
  /** Drop chances per kill (coin, dust, repair kit) and the boss chest; a repair kit heals repairHeal of max life. */
  /** `magnet`: a normal kill's chance of a magnet; `eliteMagnet`: an elite's (the boss's chest always has one). */
  drops: { coin: number; dust: number; repair: number; repairHeal: number; bossCoins: number; bossDust: number; magnet: number; eliteMagnet: number };
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
  /**
   * A comet relic makes the player's dash hit what it crosses for `damage` (× magnitude, × damage) and adds charges
   * (content.dash). `cooldown`, `distance` and `seconds` were its old automatic charge: still read, no longer used.
   */
  comet: { damage: number; cooldown?: number; distance?: number; seconds?: number };
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
  /** Magnitude by rarity tier (common → mythic; a list that stops at the legendary gives the mythic its value). */
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
  /** The mythic's own power (plan «rareza Mítica» M2): see SingularityTuning. */
  singularity: SingularityTuning;
  backgrounds: Record<string, { stat: StatKey | 'vision'; value: number }>;
  sets: RelicSetDef[];
}

/**
 * «Singularidad», the power every mythic relic has on top of its others (plan «rareza Mítica» M2, the owner's ruling):
 * every `cooldown` seconds (density and the probe's cooldown apply, like every relic power) a black hole opens on the
 * densest group of fauna within `seek` of the probe (density counted within `radius`), never within `clear` of a standing
 * probe (its own or a teammate's: it would pull the fauna onto it). For `seconds` it pulls the fauna
 * within `radius` towards it at `pull` units per second (never a Núcleo, never the loot), then collapses: `damage` ×
 * the relic's magnitude × the probe's damage to everything within `blast`. The radii follow the probe's area, not the
 * magnitude. At most one open per probe. Its collapse throws what survives `push` units back out (the knockback of the
 * areas, never a Núcleo), so the fauna it gathered spreads again instead of staying in a ball.
 */
export interface SingularityTuning {
  cooldown: number;
  seconds: number;
  seek: number;
  radius: number;
  pull: number;
  blast: number;
  damage: number;
  push: number;
  clear: number;
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
  /** No single enemy hit takes more than this share of a probe's maximum life (1: no cap). */
  hitCap: number;
  /** Life stolen heals at most maxHp × (base + perLifesteal × lifesteal) a second, banked up to `burst` seconds. */
  healing: { base: number; perLifesteal: number; burst: number };
  /**
   * «La Estática te alcanza»: `warn` s inside `radius` warn; from `hurt` s it hurts maxHp × min(max, damage + growth ×
   * the seconds since) a second and blocks healing, until the probe leaves the area. hurt 0: off.
   */
  stillness: { radius: number; warn: number; hurt: number; damage: number; growth: number; max: number };
  arena: { viewW: number; viewH: number; margin: number; despawn: number };
  /**
   * Loose items that expire (2026-11-22; systems/pickups.ts): data fragments and repair kits left on the ground go after
   * `lifeSeconds`, blinking for the last `fadeSeconds` (only the drawing). 0: they never go.
   */
  pickups: { lifeSeconds: number; fadeSeconds: number };
  limits: { weapons: number; passives: number; enemies: number; shots: number; foeShots: number; pickups: number; areas: number; props: number };
  anomalies: AnomalyDef[];
  props: PropsTuning;
  satellites: SatellitesTuning;
  /** In-run events (2026-11-16): an abandoned ship, a supply capsule, a bounty hunter. */
  events: EventsTuning;
  dash: DashTuning;
}

/**
 * The player's dash (owner's plan 2026-11-13; systems/dash.ts): every probe has `charges` of it, each one back after
 * `recharge` seconds (× the cooldown stat) and at least `pause` seconds between two. It goes `distance` units in
 * `seconds`, invulnerable while it lasts and `invuln` seconds more. Each comet relic adds `cometCharges`, at most
 * `cometMax` in all, and makes it hit what it crosses (relics.phenomena.comet.damage).
 */
export interface DashTuning {
  charges: number;
  recharge: number;
  pause: number;
  distance: number;
  seconds: number;
  invuln: number;
  cometCharges: number;
  cometMax: number;
}

/**
 * Breakable props of the ground (systems/props.ts): up to `perChunk` per 256-unit chunk, with `hp` (+`hpPerLayer` per
 * layer past the first) and `radius`. Breaking one drops `components` with `componentChance` and `dustMin`–`dustMax`
 * star dust.
 */
/**
 * Abandoned satellites (plan «skins, perfil y entorno», part E; systems/world-events.ts): `chances[k]` is a run's
 * chance of at least k + 1 of them (one per layer from the first), each `earliest`–`latest` seconds into its layer's
 * waves. It comes `distance` from a probe, drifts by at `speed` (units/s) for `drift` seconds, has `hp` (+`hpPerLayer`
 * per layer past the first) and `radius`, and breaking it drops one signal.
 */
export interface SatellitesTuning {
  chances: number[];
  earliest: number;
  latest: number;
  drift: number;
  distance: number;
  speed: number;
  hp: number;
  hpPerLayer: number;
  radius: number;
}

/** The in-run events' kinds (2026-11-16): the ones that bring loot, and the hazards (nothing to win but the way out). */
export const LOOT_KINDS = ['wreck', 'capsule', 'bounty'] as const;
export const HAZARD_KINDS = ['meteors', 'storm', 'ambush', 'well'] as const;
export const EVENT_KINDS = [...LOOT_KINDS, ...HAZARD_KINDS] as const;
export type LootKind = (typeof LOOT_KINDS)[number];
export type HazardKind = (typeof HAZARD_KINDS)[number];
export type EventKind = (typeof EVENT_KINDS)[number];

/** What a loot event gives: coins, dust and components, × (1 + perLayer × (layer − 1)), floored. */
export interface EventLoot {
  coins: number;
  dust: number;
  components: number;
  perLayer: number;
}

/**
 * In-run events (2026-11-16), fixed by the run's seed. Each layer rolls each `slot` once (its chance, a moment between
 * `from` and `to` seconds, and a kind by `weights`, with each sector's own on top); an event comes `gap` seconds after the
 * previous one (and the satellite) ends, and ends `endBy` seconds before the Núcleo is due, or does not come.
 */
export interface EventsTuning {
  slots: { from: number; to: number; chance: number }[];
  gap: number;
  endBy: number;
  weights: Record<EventKind, number>;
  sectors: Record<string, Partial<Record<EventKind, number>>>;
  /** An abandoned ship: stay `hold` seconds within `radius` to loot it; it stays `life` seconds. */
  wreck: EventLoot & { distance: number; radius: number; hold: number; life: number };
  /** A supply capsule: it lands `warn` seconds after it is announced, then waits `life` seconds for a touch. */
  capsule: EventLoot & { distance: number; radius: number; warn: number; life: number };
  /** A bounty hunter: a marked enemy (× `hp` the sector's life) that flees at `speed` for `seconds`; kill it. */
  bounty: EventLoot & { distance: number; seconds: number; hp: number; speed: number };
  /**
   * A meteor shower: for `seconds`, every `every` s a meteor falls within `spread` of a probe, warned `warn` s before on a
   * circle of `radius`; it hits the probes inside for `damage` × their maximum life (the hit cap and armour count).
   */
  meteors: { seconds: number; every: number; warn: number; radius: number; damage: number; spread: number };
  /** A Static storm: a circle of `radius` that drifts to the nearest probe at `speed` (slower than any probe) for `seconds`; inside, `damage` × maximum life a second. */
  storm: { distance: number; seconds: number; radius: number; speed: number; damage: number };
  /** An ambush: warned `warn` s before, a ring of `count` (+ `perLayer` a layer past the first) of the sector's fauna closes round a probe at `distance`. */
  ambush: { distance: number; warn: number; count: number; perLayer: number };
  /** A gravity well: for `seconds`, pulls probes and loot within `radius` (up to `pull` a second at its heart, so a probe gets away); within `core`, `damage` × maximum life a second. */
  well: { distance: number; seconds: number; radius: number; pull: number; core: number; damage: number };
}

export interface PropsTuning {
  perChunk: number;
  hp: number;
  hpPerLayer: number;
  radius: number;
  componentChance: number;
  components: number;
  dustMin: number;
  dustMax: number;
}
