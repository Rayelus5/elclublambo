import { createPool, type Pool } from './pool';

// The run's entity pools and their fields (read by the renderer and the HUD as well as the systems). Positions are
// world units; `px, py` are the positions at the start of the tick, for interpolation. Timers are in ticks.

export const ENEMY_FIELDS = {
  x: 'f64',
  y: 'f64',
  px: 'f64',
  py: 'f64',
  vx: 'f64',
  vy: 'f64',
  /** Knockback velocity (units per tick), decays every tick. */
  kx: 'f64',
  ky: 'f64',
  hp: 'f64',
  maxHp: 'f64',
  shield: 'f64',
  radius: 'f64',
  speed: 'f64',
  damage: 'f64',
  /** Index into content.enemies (bosses: into content.bosses, with boss = 1). */
  type: 'u16',
  boss: 'u8',
  /** 0 none, 1 shielded, 2 swift, 3 volatile. */
  elite: 'u8',
  /** Behaviour state (0: moving; charge: 1 winding up, 2 dashing; …). */
  state: 'u8',
  timer: 'i32',
  angle: 'i32',
  facing: 'i32',
  /** A point the behaviour aims at (charges). */
  tx: 'f64',
  ty: 'f64',
  /** White hit flash for the renderer. */
  flashT: 'i32',
  /** Element statuses (GDD §5.4). */
  burnT: 'i32',
  burnDps: 'f64',
  burnStacks: 'u8',
  slowT: 'i32',
  corrT: 'i32',
  hackT: 'i32',
  freezeT: 'i32',
  /** Volatile elites: ticks left until the death explosion (the corpse lingers as a warning). */
  fuseT: 'i32',
  /** Generic per-enemy cooldown (hacked contact hits). */
  hitT: 'i32',
  /** Element mark (GDD §5.4 reactions): 1 + index in ELEMENT_IDS, and ticks left. */
  mark: 'u8',
  markT: 'i32',
  /** Ticks until this enemy can react again. */
  reactT: 'i32',
  /** Shattered: extra damage taken (fraction) and ticks left; the armoured front is broken meanwhile. */
  vulnT: 'i32',
  vulnBonus: 'f64',
  /**
   * Held by a probe's shot (a harpoon's catch, a body the sling threw, Nov plan B3): 1 + the shot's slot (0: free) and
   * that shot's generation. It neither walks nor is pushed meanwhile; a hold whose shot is gone is no hold.
   */
  held: 'u16',
  heldGen: 'u16',
} as const;

export const SHOT_FIELDS = {
  x: 'f64',
  y: 'f64',
  px: 'f64',
  py: 'f64',
  vx: 'f64',
  vy: 'f64',
  damage: 'f64',
  radius: 'f64',
  ttl: 'i32',
  pierce: 'i32',
  bounces: 'i32',
  /** Probe that fired it. */
  owner: 'u8',
  /** Visual and behaviour kind (see systems/weapons.ts SHOT). */
  kind: 'u8',
  /** 0 none, else 1 + index in ELEMENT_IDS. */
  element: 'u8',
  /** 0 weapon, 1 relic. */
  srcKind: 'u8',
  srcIdx: 'u16',
  angle: 'i32',
  /** Bounce reach (ricochet) or the enemy it is locked on (−1 none). */
  reach: 'f64',
  target: 'i32',
  /** Bit 1: already split (evolutions with `split` split once per shot). */
  flags: 'u8',
  /** A point the shot heads for or reaches (a shell's landing, a throw's aim, a lighthouse beam's tip; Nov plan B3). */
  tx: 'f64',
  ty: 'f64',
  /** The ticks it was given (a shell's flight: its arc is 1 − ttl / life). */
  life: 'i32',
} as const;

export const FOE_SHOT_FIELDS = {
  x: 'f64',
  y: 'f64',
  px: 'f64',
  py: 'f64',
  vx: 'f64',
  vy: 'f64',
  damage: 'f64',
  radius: 'f64',
  ttl: 'i32',
  /** Antimatter already rolled for this bullet (it is rolled once). */
  rolled: 'u8',
} as const;

export const AREA_FIELDS = {
  x: 'f64',
  y: 'f64',
  px: 'f64',
  py: 'f64',
  radius: 'f64',
  damage: 'f64',
  ttl: 'i32',
  /** Ticks between damage ticks, and the countdown to the next. */
  interval: 'i32',
  tickT: 'i32',
  owner: 'u8',
  element: 'u8',
  /** Visual and behaviour kind (see systems/weapons.ts AREA). */
  kind: 'u8',
  /** Cone direction and width in angle steps (width 0: full circle). */
  angle: 'i32',
  arc: 'i32',
  /** 1: follows its probe. */
  follow: 'u8',
  srcKind: 'u8',
  srcIdx: 'u16',
  knockback: 'f64',
  /** Slow factor for slowing fields (0: none). */
  slow: 'f64',
  /** Pull towards the centre in units per second (gravity wells, `vortex` areas; 0: none). */
  pull: 'f64',
} as const;

export const PICKUP_FIELDS = {
  x: 'f64',
  y: 'f64',
  px: 'f64',
  py: 'f64',
  /** 0 data fragment (XP), 1 coin, 2 star dust, 3 repair kit, 4 magnet, 5 component. */
  kind: 'u8',
  value: 'f64',
  /** Pulled towards a probe. */
  magnet: 'u8',
  mt: 'i32',
  /** Pulled by a magnet pickup: 1 + the probe that took it (0: the nearest probe). */
  to: 'u8',
} as const;

export const PICKUP = { xp: 0, coin: 1, dust: 2, repair: 3, magnet: 4, component: 5 } as const;

/**
 * Breakable props of the sector's ground (rocks, ice, coral, slag, rift crystals): placed per chunk from the run
 * seed, broken by the probes' weapons, they drop components and star dust (systems/props.ts).
 */
export const PROP_FIELDS = {
  x: 'f64',
  y: 'f64',
  hp: 'f64',
  maxHp: 'f64',
  radius: 'f64',
  /** Which of the biome's three props it looks like. */
  look: 'u8',
  /** Its chunk and its place in it (a broken prop stays broken). */
  cx: 'i32',
  cy: 'i32',
  slot: 'u8',
  /** White hit flash for the renderer. */
  flashT: 'i32',
  /** The last flying shot that hit it (1 + slot, and that shot's generation): a shot hits a prop once. */
  shot: 'i32',
  shotGen: 'u16',
  /** Ticks until an orb can hit it again. */
  touchT: 'i32',
} as const;

export type EnemyPool = Pool<typeof ENEMY_FIELDS>;
export type ShotPool = Pool<typeof SHOT_FIELDS>;
export type FoeShotPool = Pool<typeof FOE_SHOT_FIELDS>;
export type AreaPool = Pool<typeof AREA_FIELDS>;
export type PickupPool = Pool<typeof PICKUP_FIELDS>;
export type PropPool = Pool<typeof PROP_FIELDS>;

export function createPools(limits: { enemies: number; shots: number; foeShots: number; pickups: number; areas: number; props: number }) {
  return {
    enemies: createPool(limits.enemies, ENEMY_FIELDS) as EnemyPool,
    shots: createPool(limits.shots, SHOT_FIELDS) as ShotPool,
    foeShots: createPool(limits.foeShots, FOE_SHOT_FIELDS) as FoeShotPool,
    areas: createPool(limits.areas, AREA_FIELDS) as AreaPool,
    pickups: createPool(limits.pickups, PICKUP_FIELDS) as PickupPool,
    props: createPool(Math.max(1, limits.props), PROP_FIELDS) as PropPool,
  };
}
