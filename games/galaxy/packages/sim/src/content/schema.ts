import { z } from 'zod';
import { DEFAULT_CONTENT } from './default';
import {
  BIOMES,
  type Content,
  ELEMENT_IDS,
  ENEMY_FAMILIES,
  LATE_STATS,
  SPECIALS,
  STAT_KEYS,
  type StatKey,
  WEAPON_KINDS,
} from './types';

// The live-config schema of `content` (GDD §13.1 bis, §16.3). Strict everywhere: a misspelt key is an error, never
// ignored. Every catalog defaults to DEFAULT_CONTENT, and cross references (a probe's weapon, a species' offspring, a
// sector's boss…) must point at something that exists, so a published content can never break a run.

const id = z.string().regex(/^[a-z0-9-]{1,32}$/);
const sprite = z.string().regex(/^[a-z0-9-]{1,40}$/);
const name = z.string().min(1).max(60);
const text = z.string().min(1).max(200);
const n = z.number().min(0).max(1_000_000);
const unit = z.number().min(0).max(1);
const pos = z.number().gt(0).max(1_000_000);
const capValue = z.number().min(0).max(1000);

const weaponLevel = z
  .object({
    damage: n,
    cooldown: n,
    count: z.number().int().min(0).max(64),
    pierce: z.number().int().min(0).max(1000),
    speed: n,
    area: n,
    duration: n,
    range: n,
    bounces: z.number().int().min(0).max(64),
    knockback: n,
    interval: n,
  })
  .strict();

const elementId = z.enum(ELEMENT_IDS);

const weapon = z
  .object({
    id,
    name,
    kind: z.enum(WEAPON_KINDS),
    icon: sprite,
    description: text,
    levels: z.array(weaponLevel).min(1).max(8),
    element: elementId.nullable().optional(),
    special: z.enum(SPECIALS).nullable().optional(),
    evolution: z
      .object({
        from: id,
        requires: z.union([z.object({ passive: id }).strict(), z.object({ element: elementId }).strict()]),
      })
      .strict()
      .optional(),
    variant: z
      .object({ of: id, unlockAt: z.union([z.literal(4), z.literal(8)]) })
      .strict()
      .optional(),
  })
  .strict();

const passive = z
  .object({ id, name, icon: sprite, description: text, stat: z.enum(STAT_KEYS), levels: z.array(n).min(1).max(8) })
  .strict();

const quirk = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('magnet'), every: pos, radius: pos }).strict(),
  z.object({ kind: z.literal('thorns'), share: n }).strict(),
  z.object({ kind: z.literal('dash'), every: pos, distance: n, invuln: n }).strict(),
  z.object({ kind: z.literal('overwatch'), drones: z.number().int().min(0).max(8) }).strict(),
  z.object({ kind: z.literal('second-wind'), hp: unit }).strict(),
  z.object({ kind: z.literal('prism-touch'), chance: unit, cycle: z.array(elementId).min(1).max(11) }).strict(),
  z.object({ kind: z.literal('afterburner'), bonus: n, seconds: pos }).strict(),
  z.object({ kind: z.literal('salvage'), kills: z.number().int().min(1).max(10_000) }).strict(),
]);

const probe = z
  .object({
    id,
    name,
    sprite,
    description: text,
    hp: pos,
    speed: pos,
    pickup: n,
    armor: unit,
    regen: n,
    weapon: id,
    bonus: z.partialRecord(z.enum(STAT_KEYS), z.number().min(-10).max(10)),
    quirk: quirk.nullable(),
  })
  .strict();

const behavior = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chase') }).strict(),
  z.object({ kind: z.literal('charge'), range: n, windup: n, dashSpeed: n, dashTime: n, cooldown: n }).strict(),
  z
    .object({ kind: z.literal('shooter'), range: n, cooldown: pos, count: z.number().int().min(1).max(64), spread: n, bulletSpeed: n, bulletDamage: n })
    .strict(),
  z.object({ kind: z.literal('armored'), arc: z.number().min(0).max(360), reduction: unit, turnRate: n, weakTo: elementId.optional() }).strict(),
  z.object({ kind: z.literal('summoner'), cooldown: pos, minion: id, count: z.number().int().min(1).max(64) }).strict(),
  z.object({ kind: z.literal('orbit'), radius: pos, turn: n, every: pos, diveSpeed: n, diveTime: n }).strict(),
  z
    .object({ kind: z.literal('support'), effect: z.enum(['heal', 'shield']), amount: z.number().gt(0).max(1), range: pos, cooldown: pos, keep: n })
    .strict(),
  z.object({ kind: z.literal('blink'), range: pos, offset: n, windup: n, cooldown: pos }).strict(),
  z.object({ kind: z.literal('lancer'), range: pos, windup: n, cooldown: pos, bulletSpeed: pos, bulletDamage: n }).strict(),
]);

const enemy = z
  .object({
    id,
    name,
    family: z.enum(ENEMY_FAMILIES),
    sprite,
    hp: pos,
    speed: n,
    damage: n,
    radius: pos,
    xp: n,
    behavior,
    split: z.object({ into: id, count: z.number().int().min(1).max(16) }).strict().optional(),
  })
  .strict();

const elite = z
  .object({
    id: z.enum(['shielded', 'swift', 'volatile']),
    name,
    shield: z.number().min(0).max(10),
    speed: z.number().min(0.1).max(10),
    explode: z.object({ radius: n, damage: n, delay: n }).strict().nullable(),
  })
  .strict();

const bossPattern = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('radial'), count: z.number().int().min(1).max(128), speed: n, damage: n }).strict(),
  z.object({ kind: z.literal('aimed'), count: z.number().int().min(1).max(64), spread: n, speed: n, damage: n }).strict(),
  z.object({ kind: z.literal('spiral'), duration: pos, every: pos, step: n, speed: n, damage: n }).strict(),
  z.object({ kind: z.literal('summon'), enemy: id, count: z.number().int().min(1).max(64) }).strict(),
  z.object({ kind: z.literal('charge'), windup: n, dashSpeed: n, dashTime: n, damage: n }).strict(),
  z.object({ kind: z.literal('wall'), count: z.number().int().min(1).max(128), gap: z.number().min(0).max(300), speed: n, damage: n }).strict(),
  z
    .object({ kind: z.literal('mines'), count: z.number().int().min(1).max(16), spread: n, radius: pos, delay: pos, damage: n })
    .strict(),
  z.object({ kind: z.literal('blink'), offset: n, windup: pos, count: z.number().int().min(0).max(128), speed: n, damage: n }).strict(),
  // Nov plan B4: a sweeping beam, a ring closing in on the probe (always with a way out) and a walking barrage.
  z
    .object({ kind: z.literal('laser'), windup: pos, duration: pos, sweep: z.number().min(0).max(360), length: pos, width: z.number().gt(0).max(200), damage: n })
    .strict(),
  z
    .object({ kind: z.literal('closing'), count: z.number().int().min(1).max(128), radius: pos, gap: z.number().min(20).max(300), delay: pos, speed: pos, damage: n })
    .strict(),
  z
    .object({ kind: z.literal('barrage'), count: z.number().int().min(1).max(16), spacing: pos, radius: pos, delay: pos, step: n, damage: n })
    .strict(),
]);

const boss = z
  .object({
    id,
    name,
    title: name,
    sprite,
    hp: pos,
    radius: pos,
    speed: n,
    damage: n,
    xp: n,
    phases: z
      .array(z.object({ below: unit, interval: pos, telegraph: n, speed: pos, patterns: z.array(bossPattern).min(1).max(16) }).strict())
      .min(1)
      .max(8),
    scaling: z.object({ hpPerLayer: n, damagePerLayer: n }).strict(),
  })
  .strict();

const sector = z
  .object({
    id,
    name,
    description: text,
    biome: z.enum(BIOMES),
    boss: id,
    // Nov plan B4: the Core's forms in turn. Optional, so a content published before plays as it did (only `boss`).
    bossCycle: z.array(id).min(1).max(8).optional(),
    // Defaults keep a content published before M3b-3 valid.
    deepBoss: z
      .object({ boss: id, every: z.number().int().min(2).max(100), cycle: z.array(id).min(1).max(8).optional() })
      .strict()
      .nullable()
      .default(null),
    season: z.boolean().default(false),
    // Open beta: the sector's own toughness, on top of its scaling (first sector easiest, the season's hardest).
    enemyHp: z.number().min(0.25).max(4).default(1),
    enemyDamage: z.number().min(0.25).max(4).default(1),
    coreDamage: z.number().min(0.25).max(4).default(1),
    layerSeconds: pos,
    beacon: z.object({ seconds: pos, hold: pos, radius: pos, distance: n }).strict(),
    spawns: z
      .array(
        z
          .object({ enemy: id, from: n, weight: pos, group: z.tuple([z.number().int().min(1).max(64), z.number().int().min(1).max(64)]) })
          .strict()
          .refine((s) => s.group[0] <= s.group[1], 'group_order'),
      )
      .min(1)
      .max(32),
    waves: z.array(z.object({ at: n, kind: z.enum(['ring', 'burst']), enemy: id, count: z.number().int().min(1).max(200) }).strict()).max(32),
    density: z.object({ base: n, perMinute: n, max: n, cap: z.number().int().min(1).max(2000), bossFactor: unit }).strict(),
    scaling: z
      .object({
        hpPerMinute: n,
        damagePerMinute: n,
        hpPerLayer: n,
        damagePerLayer: n,
        speedPerLayer: n,
        eliteBase: unit,
        elitePerMinute: unit,
        eliteMax: unit,
      })
      .strict(),
    // An elite's coins and dust may be fractional (a dense sector pays less per elite); the HUD and the payout floor them.
    elite: z.object({ hp: pos, radius: pos, xp: n, coins: z.number().min(0).max(1000), dust: z.number().min(0).max(1000) }).strict(),
    drops: z
      .object({
        coin: unit,
        dust: unit,
        repair: unit,
        repairHeal: unit,
        bossCoins: z.number().int().min(0).max(1000),
        bossDust: z.number().int().min(0).max(1000),
        // Published contents from before the magnet (SIM 1.7.0) get the defaults.
        magnet: unit.default(DEFAULT_CONTENT.sectors[0]!.drops.magnet),
        eliteMagnet: unit.default(DEFAULT_CONTENT.sectors[0]!.drops.eliteMagnet),
      })
      .strict(),
  })
  .strict();

const element = elementId;
const count = (max: number) => z.number().int().min(1).max(max);
const reactionEffect = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chain'), targets: count(32), range: n, share: n }).strict(),
  z.object({ kind: z.literal('explode'), radius: n, share: n }).strict(),
  z.object({ kind: z.literal('shatter'), bonus: n, seconds: n, share: n }).strict(),
  z.object({ kind: z.literal('stun'), seconds: n }).strict(),
  z
    .object({ kind: z.literal('spread'), range: n, targets: count(32), statuses: z.array(z.enum(['burn', 'corrosion', 'hack'])).min(1).max(3) })
    .strict(),
  z.object({ kind: z.literal('drain'), share: n, heal: unit }).strict(),
]);
const reaction = z.object({ id, name, pair: z.tuple([element, element]), effect: reactionEffect }).strict();
const elements = z
  .object({
    palettes: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), element),
    burn: z.object({ share: n, seconds: n, stacks: z.number().int().min(1).max(10) }).strict(),
    slow: z.object({ factor: unit, seconds: n }).strict(),
    corrosion: z.object({ bonus: n, seconds: n }).strict(),
    shock: z.object({ chance: unit, targets: z.number().int().min(0).max(16), share: n, range: n }).strict(),
    hack: z.object({ chance: unit, seconds: n }).strict(),
    leech: z.object({ share: unit }).strict(),
    breach: z.object({ shield: n, armor: n }).strict(),
    chain: z.object({ bounces: z.number().int().min(0).max(16), share: n, range: n }).strict(),
    pure: z.object({ crit: unit, critDamage: n }).strict(),
    prism: z.object({ cycle: z.array(element).min(1).max(11) }).strict(),
    invert: z.object({ radius: n, chance: unit, power: n }).strict(),
    marks: z.object({ seconds: n, cooldown: n, bossStun: unit, bossStunEvery: n }).strict(),
    reactions: z.array(reaction).max(64),
  })
  .strict();

const setBonus = z
  .object({
    stats: z
      .array(z.object({ stat: z.enum(STAT_KEYS), value: z.number().min(-10).max(10) }).strict())
      .max(8)
      .optional(),
    magnitude: z.number().min(0).max(10).optional(),
    background: z.number().min(0).max(10).optional(),
  })
  .strict();
const traitValue = z.string().regex(/^[a-z0-9_]{1,40}$/);
const relicSet = z.discriminatedUnion('kind', [
  z
    .object({
      id,
      name,
      description: text,
      kind: z.literal('same'),
      trait: z.enum(['palette', 'galaxy_type', 'background', 'core']),
      tiers: z
        .array(z.object({ count: z.union([z.literal(2), z.literal(3)]), bonus: setBonus }).strict())
        .min(1)
        .max(2),
    })
    .strict(),
  z.object({ id, name, description: text, kind: z.literal('combo'), type: traitValue, phenomenon: traitValue, bonus: setBonus }).strict(),
]);

const factors = z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.number().min(0).max(100));
const relics = z
  .object({
    // Common → mythic; content published before the mythic stops at the legendary (the mythic counts as it).
    tier: z.array(z.number().min(0).max(100)).min(5).max(6),
    level: z.object({ step: n, cap: n }).strict(),
    // Older published content has no stacking: the default keeps it valid.
    stacking: z.object({ from: z.number().int().min(1).max(6), decay: unit }).strict().default({ from: 3, decay: 0.5 }),
    size: factors,
    core: factors,
    density: factors,
    weaponProc: unit,
    families: z
      .object({
        blades: z.object({ damage: n, radius: n, interval: pos, speed: n }).strict(),
        ray: z.object({ damage: n, cooldown: pos, pierce: z.number().int().min(0).max(1000), speed: n, cone: n, range: n }).strict(),
        shield: z.object({ shield: n, recharge: n }).strict(),
        lens: z.object({ crit: unit, critDamage: n }).strict(),
        chaos: z
          .object({
            cooldown: pos,
            nova: z.object({ damage: n, radius: n }).strict(),
            bolts: z.object({ count: z.number().int().min(1).max(64), damage: n, speed: n }).strict(),
            slowField: z.object({ radius: n, seconds: n }).strict(),
            haste: z.object({ bonus: n, seconds: n }).strict(),
          })
          .strict(),
        aura: z.object({ damage: n, interval: pos, radius: n, cone: z.number().min(0).max(360), coneRadius: n }).strict(),
        scout: z.object({ pickup: n, speed: n }).strict(),
        echo: z.object({ share: n }).strict(),
      })
      .strict(),
    phenomena: z
      .object({
        supernova: z.object({ cooldown: pos, damage: n, radius: n }).strict(),
        satellite_galaxy: z.object({ cooldown: pos, damage: n, range: n, speed: n }).strict(),
        globular_cluster: z.object({ count: z.number().int().min(1).max(32), damage: n, radius: n, speed: n, interval: pos }).strict(),
        comet: z.object({ cooldown: pos, distance: n, seconds: pos, damage: n }).strict(),
        relativistic_jets: z.object({ cooldown: pos, damage: n, pierce: z.number().int().min(0).max(1000), speed: n }).strict(),
        pulsar: z.object({ cooldown: pos, radius: n, damage: n }).strict(),
        einstein_ring: z.object({ projectiles: z.number().int().min(0).max(8) }).strict(),
        anomaly: z
          .object({
            cooldown: pos,
            blink: n,
            freezeRadius: n,
            freezeSeconds: n,
            strikeDamage: n,
            strikeCount: z.number().int().min(0).max(64),
          })
          .strict(),
      })
      .strict(),
    quasar: z.object({ cooldown: pos, damage: n, pierce: z.number().int().min(0).max(1000), speed: n }).strict(),
    double: z.object({ delay: n }).strict(),
    // The mythic's own power (plan «rareza Mítica» M2): content published before it gets the default.
    singularity: z
      .object({ cooldown: pos, seconds: pos, seek: n, radius: n, pull: n, blast: n, damage: n, push: n })
      .strict()
      .default(DEFAULT_CONTENT.relics.singularity),
    backgrounds: z.record(
      z.string().regex(/^[a-z0-9_]{1,40}$/),
      z.object({ stat: z.union([z.enum(STAT_KEYS), z.literal('vision')]), value: z.number().min(-10).max(10) }).strict(),
    ),
    sets: z.array(relicSet).max(64),
  })
  .strict();

const limitInt = (max: number) => z.number().int().min(1).max(max);

const D = DEFAULT_CONTENT;
const mult = z.number().min(0.25).max(4).default(1);
const anomaly = z
  .object({
    id,
    name,
    description: z.string().min(1).max(160),
    enemyHp: mult,
    enemyDamage: mult,
    enemySpeed: mult,
    spawn: mult,
    elite: mult,
    xp: mult,
    contagion: z.object({ radius: z.number().min(1).max(400), seconds: z.number().min(0.1).max(30) }).strict().nullable().default(null),
  })
  .strict();

const shape = z
  .object({
    probes: z.array(probe).min(1).max(32).default(D.probes),
    weapons: z.array(weapon).min(1).max(64).default(D.weapons),
    passives: z.array(passive).min(1).max(64).default(D.passives),
    enemies: z.array(enemy).min(1).max(128).default(D.enemies),
    elites: z.array(elite).max(8).default(D.elites),
    bosses: z.array(boss).min(1).max(32).default(D.bosses),
    sectors: z.array(sector).min(1).max(32).default(D.sectors),
    elements: elements.default(D.elements),
    relics: relics.default(D.relics),
    // A level always costs something: with base 0 the run would level up forever in one tick.
    xp: z.object({ base: z.number().min(1).max(1_000_000), linear: n, quad: n }).strict().default(D.xp),
    // Every stat has a cap; those added later default, so content published before them still parses (Nov plan B2).
    caps: z
      .object(Object.fromEntries(STAT_KEYS.map((k) => [k, (LATE_STATS as readonly string[]).includes(k) ? capValue.default(D.caps[k]) : capValue])) as unknown as { [K in StatKey]: z.ZodType<number> })
      .strict()
      .default(D.caps),
    crit: z.object({ chance: unit, damage: z.number().min(1).max(10) }).strict().default(D.crit),
    arena: z.object({ viewW: pos, viewH: pos, margin: n, despawn: pos }).strict().default(D.arena),
    anomalies: z.array(anomaly).max(20).default(D.anomalies),
    limits: z
      .object({
        weapons: limitInt(12),
        passives: limitInt(12),
        enemies: limitInt(2000),
        shots: limitInt(5000),
        foeShots: limitInt(5000),
        pickups: limitInt(5000),
        areas: limitInt(2000),
        props: limitInt(1000).default(D.limits.props),
      })
      .strict()
      .default(D.limits),
    props: z
      .object({
        perChunk: z.number().int().min(0).max(8),
        hp: pos,
        hpPerLayer: n,
        radius: z.number().min(2).max(64),
        componentChance: unit,
        components: z.number().int().min(0).max(100),
        dustMin: z.number().int().min(0).max(100),
        dustMax: z.number().int().min(0).max(100),
      })
      .strict()
      .refine((p) => p.dustMax >= p.dustMin, 'props_dust_range')
      .default(D.props),
    // Plan «skins, perfil y entorno», part E: abandoned satellites. The chances only go down (at least one, two, three).
    satellites: z
      .object({
        chances: z.array(unit).max(3),
        earliest: z.number().min(0).max(1200),
        latest: z.number().min(0).max(1200),
        drift: z.number().min(5).max(300),
        distance: z.number().min(0).max(2000),
        speed: z.number().min(0).max(400),
        hp: pos,
        hpPerLayer: n,
        radius: z.number().min(2).max(64),
      })
      .strict()
      .refine((s) => s.latest >= s.earliest, 'satellites_window')
      .refine((s) => s.chances.every((c, k) => k === 0 || c <= s.chances[k - 1]!), 'satellites_chances')
      .default(D.satellites),
  })
  .strict();

type Ctx = z.core.$RefinementCtx<z.output<typeof shape>>;

function unique(ctx: Ctx, catalog: string, ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: `content_dup:${catalog}`, path: [catalog] });
}

function ref(ctx: Ctx, known: ReadonlySet<string>, value: string, path: (string | number)[]): void {
  if (!known.has(value)) ctx.addIssue({ code: 'custom', message: `content_ref:${path.join('.')}`, path });
}

type Shape = z.output<typeof shape>;

/** Evolutions: from an existing base weapon of the same kind, one per weapon, one level, a known passive. */
function evolutions(c: Shape, ctx: Ctx): void {
  const passives = new Set(c.passives.map((p) => p.id));
  const byId = new Map(c.weapons.map((w) => [w.id, w]));
  const taken = new Set<string>();
  c.weapons.forEach((w, i) => {
    if (!w.evolution) return;
    const bad = () => ctx.addIssue({ code: 'custom', message: `content_evolution:weapons.${i}`, path: ['weapons', i, 'evolution'] });
    const base = byId.get(w.evolution.from);
    if (!base) ref(ctx, new Set(), w.evolution.from, ['weapons', i, 'evolution', 'from']);
    else if (base.evolution || base.kind !== w.kind || taken.has(base.id)) bad();
    if (w.levels.length !== 1) bad();
    taken.add(w.evolution.from);
    const req = w.evolution.requires;
    if ('passive' in req) ref(ctx, passives, req.passive, ['weapons', i, 'evolution', 'requires', 'passive']);
  });
}

/** Variants: of a base weapon of the same kind (not an evolution, not a variant), at most one per base and level. */
function variants(c: Shape, ctx: Ctx): void {
  const byId = new Map(c.weapons.map((w) => [w.id, w]));
  const taken = new Set<string>();
  c.weapons.forEach((w, i) => {
    if (!w.variant) return;
    const bad = () => ctx.addIssue({ code: 'custom', message: `content_variant:weapons.${i}`, path: ['weapons', i, 'variant'] });
    const base = byId.get(w.variant.of);
    if (!base) ref(ctx, new Set(), w.variant.of, ['weapons', i, 'variant', 'of']);
    else if (base.evolution || base.variant || base.kind !== w.kind) bad();
    if (w.evolution) bad();
    const slot = `${w.variant.of}@${w.variant.unlockAt}`;
    if (taken.has(slot)) bad();
    taken.add(slot);
  });
}

/** Reactions: two different elements, one reaction per pair whatever the order. */
function reactions(c: Shape, ctx: Ctx): void {
  unique(ctx, 'reactions', c.elements.reactions.map((r) => r.id));
  const pairs = new Set<string>();
  c.elements.reactions.forEach((r, i) => {
    const [a, b] = r.pair;
    const key = a < b ? `${a}+${b}` : `${b}+${a}`;
    if (a === b || pairs.has(key)) ctx.addIssue({ code: 'custom', message: `content_reaction:elements.reactions.${i}`, path: ['elements', 'reactions', i] });
    pairs.add(key);
  });
}

/** Relic sets: unique ids, ascending tiers. */
function sets(c: Shape, ctx: Ctx): void {
  unique(ctx, 'sets', c.relics.sets.map((s) => s.id));
  c.relics.sets.forEach((s, i) => {
    if (s.kind === 'same' && !s.tiers.every((t, k) => k === 0 || t.count > s.tiers[k - 1]!.count)) {
      ctx.addIssue({ code: 'custom', message: `content_set:relics.sets.${i}`, path: ['relics', 'sets', i, 'tiers'] });
    }
  });
}

/** The live-config schema of `content`; `contentSchema.parse({})` is DEFAULT_CONTENT. */
export const contentSchema = shape.superRefine((c, ctx) => {
  for (const [catalog, list] of [
    ['probes', c.probes],
    ['weapons', c.weapons],
    ['passives', c.passives],
    ['enemies', c.enemies],
    ['elites', c.elites],
    ['bosses', c.bosses],
    ['sectors', c.sectors],
  ] as const) {
    unique(ctx, catalog, list.map((x) => x.id));
  }
  const weapons = new Set(c.weapons.map((w) => w.id));
  const enemies = new Set(c.enemies.map((e) => e.id));
  const bosses = new Set(c.bosses.map((b) => b.id));
  c.probes.forEach((p, i) => ref(ctx, weapons, p.weapon, ['probes', i, 'weapon']));
  c.enemies.forEach((e, i) => {
    if (e.split) ref(ctx, enemies, e.split.into, ['enemies', i, 'split', 'into']);
    if (e.behavior.kind === 'summoner') ref(ctx, enemies, e.behavior.minion, ['enemies', i, 'behavior', 'minion']);
  });
  c.bosses.forEach((b, i) => {
    b.phases.forEach((ph, j) =>
      ph.patterns.forEach((p, k) => {
        if (p.kind === 'summon') ref(ctx, enemies, p.enemy, ['bosses', i, 'phases', j, 'patterns', k, 'enemy']);
      }),
    );
    const ordered = b.phases[0]?.below === 1 && b.phases.every((ph, j) => j === 0 || ph.below < b.phases[j - 1]!.below);
    if (!ordered) ctx.addIssue({ code: 'custom', message: `content_phases:bosses.${i}`, path: ['bosses', i, 'phases'] });
  });
  evolutions(c, ctx);
  variants(c, ctx);
  reactions(c, ctx);
  sets(c, ctx);
  c.sectors.forEach((s, i) => {
    ref(ctx, bosses, s.boss, ['sectors', i, 'boss']);
    if (s.deepBoss) ref(ctx, bosses, s.deepBoss.boss, ['sectors', i, 'deepBoss', 'boss']);
    // Nov plan B4: every form exists, and each cycle starts with its Core (the one the hangar shows as form 1).
    const cycles: [string, string[] | undefined, (string | number)[]][] = [[s.boss, s.bossCycle, ['sectors', i, 'bossCycle']]];
    if (s.deepBoss) cycles.push([s.deepBoss.boss, s.deepBoss.cycle, ['sectors', i, 'deepBoss', 'cycle']]);
    for (const [first, cycle, path] of cycles) {
      if (!cycle) continue;
      cycle.forEach((b, j) => ref(ctx, bosses, b, [...path, j]));
      if (cycle[0] !== first) ctx.addIssue({ code: 'custom', message: `content_cycle:${path.join('.')}`, path });
    }
    s.spawns.forEach((sp, j) => ref(ctx, enemies, sp.enemy, ['sectors', i, 'spawns', j, 'enemy']));
    s.waves.forEach((w, j) => ref(ctx, enemies, w.enemy, ['sectors', i, 'waves', j, 'enemy']));
  });
});

// The schema's output is exactly the Content type (a compile-time check: a drift between the two fails typecheck).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _sameAsContent: Same<z.output<typeof contentSchema>, Content> = true;
void _sameAsContent;
