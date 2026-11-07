import { contentSchema } from '@galaxy/sim';
import { z } from 'zod';
import { TRAIT_KEYS } from '../gacha/types';

/**
 * Registro de la configuración viva (GDD §16.3). Cada clave tiene su esquema; la base guarda versiones de solo
 * añadir en galaxy.game_config_versions y el servidor valida con estos esquemas al leer y al publicar.
 * Los esquemas son estrictos: una clave mal escrita es un error, nunca se ignora en silencio.
 */
const limit = (def: number) => z.number().int().min(1).max(1000).default(def);

const probability = z.number().min(0).max(1);
/** A list of probabilities that must add up to 1 (± 1e-9), e.g. one per tier or finish. */
const distribution = (def: number[]) =>
  z
    .array(probability)
    .length(def.length)
    .refine((p) => Math.abs(p.reduce((a, b) => a + b, 0) - 1) <= 1e-9, 'must_sum_to_1')
    .default(def);

const pityFields = {
  base: probability,
  softStart: z.number().int().min(1).max(500),
  softStep: z.number().min(0).max(1),
  hard: z.number().int().min(1).max(500),
};
type Pity = { base: number; softStart: number; softStep: number; hard: number };
/** Rising luck and guarantee: chance of pull n (1-based since the last hit) = base + max(0, n − softStart + 1)·softStep; n ≥ hard → 1. */
const pity = (def: Pity) =>
  z
    .object(pityFields)
    .strict()
    .refine((p) => p.hard >= p.softStart, 'hard_before_soft')
    .default(def);

const banner = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,32}$/),
    kind: z.enum(['standard', 'event']),
    name: z.string().min(1).max(60),
    pityGroup: z.string().regex(/^[a-z0-9-]{1,32}$/),
    currency: z.union([z.literal('signal'), z.string().regex(/^signal:[a-z0-9-]{1,32}$/)]),
    featured: z.object({ trait: z.enum(TRAIT_KEYS), value: z.string().min(1).max(40) }).strict().optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
  })
  .strict()
  .refine(
    (b) => b.kind === 'standard' || (b.featured !== undefined && b.currency.startsWith('signal:')),
    'event_needs_featured_and_own_signals',
  );

const DEFAULT_BANNERS = [
  { id: 'deep-scan', kind: 'standard' as const, name: 'Escáner profundo', pityGroup: 'standard', currency: 'signal' },
];

export const configSchemas = {
  features: z
    .object({
      registrationOpen: z.boolean().default(true),
      maintenance: z.boolean().default(false),
      gacha: z.boolean().default(true),
      runs: z.boolean().default(true),
    })
    .strict(),
  auth: z.object({
    sessionDays: z.number().int().min(1).max(90).default(30),
    adminSessionHours: z.number().int().min(1).max(72).default(12),
    registerPerIpHour: limit(5),
    loginPerIpTenMin: limit(30),
    loginPerUserTenMin: limit(10),
    totpPerAccountTenMin: limit(10),
    resetRedeemPerIpHour: limit(10),
  }).strict(),
  /** Deep scan (GDD §9). Tier order: common, uncommon, rare, epic, legendary. Finish order: see FINISHES. */
  gacha: z
    .object({
      tiers: z
        .object({ base: distribution([0.5, 0.28, 0.13, 0.06, 0.03]) })
        .strict()
        .default({ base: [0.5, 0.28, 0.13, 0.06, 0.03] }),
      standard: pity({ base: 0.03, softStart: 8, softStep: 0.06, hard: 20 }),
      welcome: z
        .object({ ...pityFields, signals: z.number().int().min(0).max(1000) })
        .strict()
        .refine((p) => p.hard >= p.softStart, 'hard_before_soft')
        .default({ base: 0.06, softStart: 5, softStep: 0.15, hard: 10, signals: 10 }),
      featured: pity({ base: 0.005, softStart: 30, softStep: 0.04, hard: 45 }),
      costs: z
        .object({
          coins: z.number().int().min(0).max(1_000_000),
          coinsTen: z.number().int().min(0).max(10_000_000),
          signals: z.number().int().min(1).max(100),
        })
        .strict()
        .default({ coins: 100, coinsTen: 900, signals: 1 }),
      dailyFree: z.boolean().default(true),
      finishes: distribution([0.85, 0.1, 0.035, 0.013, 0.002]),
      banners: z
        .array(banner)
        .min(1)
        .max(20)
        .refine((list) => new Set(list.map((b) => b.id)).size === list.length, 'duplicate_banner_id')
        .default(DEFAULT_BANNERS),
    })
    .strict(),
  /** Disintegration yields (dust per tier × finish multiplier) and fusion recipes (GDD §8.5). */
  galaxies: z
    .object({
      disintegrate: z
        .object({
          tier: z.array(z.number().int().min(0).max(1_000_000)).length(5),
          finish: z.array(z.number().min(0).max(100)).length(5),
        })
        .strict()
        .default({ tier: [5, 12, 30, 75, 200], finish: [1, 1.5, 2, 2.5, 5] }),
      fusion: z
        .object({
          count: z.number().int().min(2).max(10),
          dust: z.array(z.number().int().min(0).max(1_000_000)).length(4),
        })
        .strict()
        .default({ count: 5, dust: [20, 50, 120, 300] }),
    })
    .strict(),
  /** Run content as data (GDD §13.1 bis): sectors, fauna, bosses, weapons, passives, elements and relic tuning. */
  content: contentSchema,
  /** Run economy (GDD §5.1, §11.3 bis, §14.7): depth multipliers, death share, daily yield and plausibility caps. */
  runs: z
    .object({
      depth: z
        .object({ table: z.array(z.number().min(0).max(100)).min(1).max(10), step: z.number().min(0).max(100) })
        .strict()
        .default({ table: [1, 1.5, 2.2, 3], step: 0.8 }),
      deathShare: probability.default(0.5),
      daily: z
        .object({ hours: z.array(z.number().gt(0).max(24)).min(1).max(6), multipliers: z.array(probability).min(2).max(7) })
        .strict()
        .refine((d) => d.multipliers.length === d.hours.length + 1, 'daily_shape')
        .refine((d) => d.hours.every((h, i) => i === 0 || h > d.hours[i - 1]!), 'daily_hours_increasing')
        .refine((d) => d.multipliers.every((m, i) => i === 0 || m <= d.multipliers[i - 1]!), 'daily_multipliers_decreasing')
        .default({ hours: [3, 4, 5], multipliers: [1, 0.75, 0.5, 0.25] }),
      signalChancePerBoss: probability.default(0.1),
      caps: z
        .object({
          killsPerMinute: z.number().int().min(1).max(100_000),
          coinsPerKill: z.number().min(0).max(1000),
          dustPerKill: z.number().min(0).max(1000),
          bossCoins: z.number().int().min(0).max(100_000),
          bossDust: z.number().int().min(0).max(100_000),
          slackSeconds: z.number().int().min(0).max(3600),
          /** The most one run pays, whatever it claims (until replays verify runs, M5). */
          runCoins: z.number().int().min(0).max(10_000_000).default(20_000),
          runDust: z.number().int().min(0).max(10_000_000).default(10_000),
        })
        .strict()
        .default({ killsPerMinute: 900, coinsPerKill: 0.25, dustPerKill: 0.12, bossCoins: 30, bossDust: 10, slackSeconds: 20, runCoins: 20_000, runDust: 10_000 }),
      expireHours: z.number().int().min(1).max(168).default(24),
      startPerHour: limit(30),
    })
    .strict(),
  /**
   * Probes (GDD §6): what earns every probe but the test's one. The three starters are the test's (STARTERS), not a
   * setting: the questions, profiles and reveal are written for them. Only runs of `minRunSeconds` or more count.
   */
  probes: z
    .object({
      minRunSeconds: z.number().int().min(0).max(3600).default(60),
      starterUnlock: z.object({ stat: z.enum(['runs', 'bossKills', 'maxDepth', 'extractions', 'kills']), value: z.number().int().min(1).max(1_000_000) }).strict().default({ stat: 'runs', value: 3 }),
      unlocks: z.record(z.string().regex(/^[a-z0-9-]{1,32}$/), z.object({ stat: z.enum(['runs', 'bossKills', 'maxDepth', 'extractions', 'kills']), value: z.number().int().min(1).max(1_000_000) }).strict()).default({
        sentinel: { stat: 'bossKills', value: 3 },
        anchor: { stat: 'maxDepth', value: 4 },
        prism: { stat: 'extractions', value: 5 },
        comet: { stat: 'kills', value: 2000 },
        echo: { stat: 'runs', value: 15 },
      }),
    })
    .strict(),
} as const;

export type ConfigKey = keyof typeof configSchemas;
export type ConfigValue<K extends ConfigKey> = z.output<(typeof configSchemas)[K]>;
export const CONFIG_KEYS = Object.keys(configSchemas) as ConfigKey[];

export function isConfigKey(key: string): key is ConfigKey {
  return Object.hasOwn(configSchemas, key);
}

/** Valida `data` con el esquema de `key` y devuelve el valor con los valores por defecto aplicados. Lanza si no vale. */
export function parseConfig<K extends ConfigKey>(key: K, data: unknown): ConfigValue<K> {
  if (!isConfigKey(key)) throw new Error(`unknown_config_key:${String(key)}`);
  return configSchemas[key].parse(data) as ConfigValue<K>;
}
