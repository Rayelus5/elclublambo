import { contentSchema, STAT_KEYS } from '@galaxy/sim';
import { DEFAULT_LAB_NODES } from '../lab/tree';
import { z } from 'zod';
import es from 'zod/v4/locales/es.js';
import { TRAIT_KEYS } from '../gacha/types';
import { achievementSchema, DEFAULT_ACHIEVEMENTS, DEFAULT_DAILY, DEFAULT_SEASON, DEFAULT_WEEKLY, missionSchema } from '../progress/missions';
import { catalogRewardSchema, DEFAULT_CATALOG_REWARDS } from '../progress/catalog';
import { seasonRouteSchema } from '../progress/season-route';

/** Zod's messages in Spanish, only for the drafts the admin panel checks (the rest keep the default). */
const esIssues = es().localeError;

/** Levels 2–30: the first nine by hand, then 1000 more each (GDD §12.1; M5a). */
const DEFAULT_ACCOUNT_LEVELS = [100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500, ...Array.from({ length: 20 }, (_, i) => 5500 + i * 1000)];

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
      /** M6b: the market, the swaps and the chat can be switched off from the admin panel. */
      market: z.boolean().default(true),
      trades: z.boolean().default(true),
      chat: z.boolean().default(true),
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
      /** Raw material a run brings (GDD §10.3): per layer reached, per Core beaten and per hundred kills; paid like the loot. */
      material: z
        .object({ perLayer: z.number().min(0).max(10_000), perBoss: z.number().min(0).max(10_000), perHundredKills: z.number().min(0).max(10_000) })
        .strict()
        .default({ perLayer: 6, perBoss: 10, perHundredKills: 2 }),
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
          runMaterial: z.number().int().min(0).max(10_000_000).default(500),
        })
        .strict()
        .default({ killsPerMinute: 900, coinsPerKill: 0.25, dustPerKill: 0.12, bossCoins: 30, bossDust: 10, slackSeconds: 20, runCoins: 20_000, runDust: 10_000, runMaterial: 500 }),
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
      /**
       * Probe levels (GDD §6, M4b-1): what each level above 1 adds to the probe's stats (a sim stat source, so it goes
       * through the diminishing returns and caps of §8.6) and what reaching each level costs (costs[i] → level i + 2).
       */
      levels: z
        .object({
          perLevel: z.partialRecord(z.enum(STAT_KEYS), z.number().min(0).max(0.2)),
          costs: z
            .array(z.object({ components: z.number().int().min(0).max(1_000_000), coins: z.number().int().min(0).max(100_000_000) }).strict())
            .min(1)
            .max(19),
        })
        .strict()
        .default({
          perLevel: { maxHp: 0.03, damage: 0.02 },
          costs: [
            { components: 20, coins: 300 },
            { components: 35, coins: 600 },
            { components: 60, coins: 1000 },
            { components: 90, coins: 1600 },
            { components: 130, coins: 2400 },
            { components: 180, coins: 3400 },
            { components: 240, coins: 4600 },
            { components: 310, coins: 6000 },
            { components: 400, coins: 8000 },
          ],
        }),
    })
    .strict(),
  /**
   * The Laboratorio (GDD §10.6, M4b-2): the upgrade tree. Each node has a branch, an effect, what each level adds
   * (`per`), its levels (`max`), the node it needs (`requires`, at level 1) and a base cost growing by `growth` per level.
   * Brakes: no cycles, and fusion discounts and run pay bonuses add up to at most half.
   */
  lab: z
    .object({
      nodes: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9-]{1,32}$/),
              branch: z.enum(['probe', 'relics', 'station', 'extraction']),
              name: z.string().min(1).max(40),
              effect: z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('stat'), stat: z.enum(STAT_KEYS) }).strict(),
                z.object({ kind: z.literal('payout'), currency: z.enum(['coins', 'dust', 'material']) }).strict(),
                z.object({ kind: z.literal('refinery'), field: z.enum(['rate', 'queue']) }).strict(),
                z.object({ kind: z.literal('antenna') }).strict(),
                z.object({ kind: z.literal('disintegrate') }).strict(),
                z.object({ kind: z.literal('fusion') }).strict(),
              ]),
              per: z.number().gt(0).max(0.2),
              max: z.number().int().min(1).max(10),
              requires: z.string().regex(/^[a-z0-9-]{1,32}$/).nullable(),
              cost: z.object({ dust: z.number().int().min(0).max(10_000_000), components: z.number().int().min(0).max(1_000_000) }).strict(),
              growth: z.number().min(1).max(3),
            })
            .strict(),
        )
        .min(1)
        .max(200)
        .superRefine((nodes, ctx) => {
          const ids = new Set<string>();
          for (const n of nodes) {
            if (ids.has(n.id)) ctx.addIssue({ code: 'custom', message: `lab_duplicate:${n.id}` });
            ids.add(n.id);
          }
          const byId = new Map(nodes.map((n) => [n.id, n]));
          for (const n of nodes) {
            if (n.requires !== null && !byId.has(n.requires)) ctx.addIssue({ code: 'custom', message: `lab_requires:${n.id}` });
            // Follow the chain of requirements: a node seen twice is a cycle.
            const seen = new Set<string>([n.id]);
            for (let at = n.requires; at !== null; at = byId.get(at)?.requires ?? null) {
              if (seen.has(at)) {
                ctx.addIssue({ code: 'custom', message: `lab_cycle:${n.id}` });
                break;
              }
              seen.add(at);
            }
          }
          const sum = (pick: (n: (typeof nodes)[number]) => boolean) => nodes.filter(pick).reduce((a, n) => a + n.per * n.max, 0);
          if (sum((n) => n.effect.kind === 'fusion') > 0.5 + 1e-9) ctx.addIssue({ code: 'custom', message: 'lab_fusion_cap' });
          for (const c of ['coins', 'dust', 'material'] as const) {
            if (sum((n) => n.effect.kind === 'payout' && n.effect.currency === c) > 0.5 + 1e-9) ctx.addIssue({ code: 'custom', message: `lab_payout_cap:${c}` });
          }
        })
        .default(DEFAULT_LAB_NODES),
    })
    .strict(),
  /**
   * Relic levels and slots (GDD §8.4, §8.4 bis; M4c-1): the dust of reaching each level from 2 to 10, the share of it
   * returned when a galaxy is fused or disintegrated, and the milestone and dust of each slot from the third to the sixth.
   */
  relics: z
    .object({
      levels: z
        .array(z.number().int().min(0).max(1_000_000))
        .length(9)
        .default([20, 35, 55, 80, 110, 150, 200, 260, 330]),
      refund: z.number().min(0).max(1).default(0.5),
      slots: z
        .array(
          z
            .object({
              condition: z.object({ stat: z.enum(['runs', 'bossKills', 'maxDepth', 'extractions', 'kills']), value: z.number().int().min(1).max(1_000_000) }).strict(),
              dust: z.number().int().min(0).max(10_000_000),
            })
            .strict(),
        )
        .max(4)
        .default([
          { condition: { stat: 'runs', value: 5 }, dust: 100 },
          { condition: { stat: 'bossKills', value: 3 }, dust: 300 },
          { condition: { stat: 'maxDepth', value: 4 }, dust: 600 },
          { condition: { stat: 'extractions', value: 10 }, dust: 1000 },
        ]),
    })
    .strict(),
  /**
   * The station (GDD §10): the refinery's levels (material per hour, queue, cost of reaching the level) and the
   * antenna's (signals per hour, cost; level 1's cost is the repair), with its cap in hours.
   */
  station: z
    .object({
      refinery: z
        .array(z.object({ rate: z.number().gt(0).max(100_000), queue: z.number().int().min(1).max(10_000_000), cost: z.object({ components: z.number().int().min(0).max(1_000_000), coins: z.number().int().min(0).max(100_000_000) }).strict() }).strict())
        .min(1)
        .max(10)
        .refine((ls) => ls.every((l, i) => i === 0 || (l.rate >= ls[i - 1]!.rate && l.queue >= ls[i - 1]!.queue)), 'refinery_levels_increasing')
        .default([
          { rate: 20, queue: 100, cost: { components: 0, coins: 0 } },
          { rate: 30, queue: 150, cost: { components: 40, coins: 500 } },
          { rate: 45, queue: 250, cost: { components: 90, coins: 1200 } },
          { rate: 65, queue: 400, cost: { components: 180, coins: 2500 } },
          { rate: 90, queue: 600, cost: { components: 320, coins: 5000 } },
        ]),
      antenna: z
        .object({
          capHours: z.number().gt(0).max(72).default(8),
          levels: z
            .array(z.object({ rate: z.number().gt(0).max(100), cost: z.object({ components: z.number().int().min(0).max(1_000_000), coins: z.number().int().min(0).max(100_000_000) }).strict() }).strict())
            .min(1)
            .max(10)
            .refine((ls) => ls.every((l, i) => i === 0 || l.rate >= ls[i - 1]!.rate), 'antenna_levels_increasing')
            .default([
              { rate: 0.125, cost: { components: 30, coins: 0 } },
              { rate: 0.15, cost: { components: 40, coins: 400 } },
              { rate: 0.175, cost: { components: 80, coins: 900 } },
              { rate: 0.2, cost: { components: 150, coins: 1800 } },
              { rate: 0.25, cost: { components: 260, coins: 3500 } },
            ]),
        })
        .strict()
        .default({
          capHours: 8,
          levels: [
            { rate: 0.125, cost: { components: 30, coins: 0 } },
            { rate: 0.15, cost: { components: 40, coins: 400 } },
            { rate: 0.175, cost: { components: 80, coins: 900 } },
            { rate: 0.2, cost: { components: 150, coins: 1800 } },
            { rate: 0.25, cost: { components: 260, coins: 3500 } },
          ],
        }),
      /** The Laboratorio's repair (M4b-2): one level, from broken to working. */
      lab: z
        .object({
          levels: z
            .array(z.object({ cost: z.object({ components: z.number().int().min(0).max(1_000_000), coins: z.number().int().min(0).max(100_000_000) }).strict() }).strict())
            .min(1)
            .max(1),
        })
        .strict()
        .default({ levels: [{ cost: { components: 50, coins: 500 } }] }),
    })
    .strict(),
  /**
   * The account level (GDD §12.1; M5a): the experience a run that is not suspicious gives (per whole minute, per
   * layer, per Core and for extracting; never cut by the daily yield) and the experience needed to reach each level
   * from 2, growing.
   */
  account: z
    .object({
      xp: z
        .object({
          perMinute: z.number().int().min(0).max(10_000).default(10),
          perLayer: z.number().int().min(0).max(10_000).default(15),
          perCore: z.number().int().min(0).max(10_000).default(40),
          extraction: z.number().int().min(0).max(10_000).default(30),
          /** A run never gives more than this per minute it lasted (a forged short run is worth what a real one is). */
          capPerMinute: z.number().int().min(1).max(10_000).default(30),
        })
        .strict()
        .default({ perMinute: 10, perLayer: 15, perCore: 40, extraction: 30, capPerMinute: 30 }),
      /** A run counts for experience and season points from this long (like probe unlocks and slot milestones). */
      minRunSeconds: z.number().int().min(0).max(3600).default(60),
      levels: z
        .array(z.number().int().min(1).max(100_000_000))
        .min(1)
        .max(99)
        .refine((ls) => ls.every((l, i) => i === 0 || l > ls[i - 1]!), 'account_levels_increasing')
        .default(DEFAULT_ACCOUNT_LEVELS),
    })
    .strict(),
  /**
   * The chats (GDD §14.4; M5b-2): the account level writing needs, the messages a minute, the most characters a
   * message keeps, how many the history shows, how many reports hide one, and the words the filter covers.
   */
  chat: z
    .object({
      minLevel: z.number().int().min(1).max(99).default(5),
      perMinute: z.number().int().min(1).max(60).default(6),
      maxLength: z.number().int().min(20).max(1000).default(280),
      history: z.number().int().min(10).max(200).default(50),
      hideAfter: z.number().int().min(1).max(20).default(3),
      words: z
        .array(z.string().regex(/^[\p{L}\p{N}]{2,40}$/u))
        .max(500)
        .default([]),
    })
    .strict(),
  /**
   * The market (GDD §14.6, §14.7; M5c-1): the lowest price per rarity (growing with it; a trigger enforces it), the
   * highest price, the share kept of each sale, how long a listing stays up, today's caps, who may trade (level and
   * days of account), and when a sale warns the admin (a price this many times the floor, an IP shared in these days).
   */
  market: z
    .object({
      minPrice: z
        .object({
          common: z.number().int().min(1).default(50),
          uncommon: z.number().int().min(1).default(120),
          rare: z.number().int().min(1).default(400),
          epic: z.number().int().min(1).default(1500),
          legendary: z.number().int().min(1).default(6000),
        })
        .strict()
        .refine((m) => m.common <= m.uncommon && m.uncommon <= m.rare && m.rare <= m.epic && m.epic <= m.legendary, 'minPrice grows with the tier')
        .default({ common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 6000 }),
      maxPrice: z.number().int().min(1).max(1_000_000_000).default(10_000_000),
      commission: z.number().min(0).max(0.5).default(0.07),
      days: z.number().int().min(1).max(60).default(7),
      perDay: z
        .object({
          listings: z.number().int().min(1).max(1000).default(10),
          purchases: z.number().int().min(1).max(1000).default(10),
          /** Swaps proposed a day (M5c-2). */
          trades: z.number().int().min(1).max(1000).default(10),
        })
        .strict()
        .default({ listings: 10, purchases: 10, trades: 10 }),
      minLevel: z.number().int().min(1).max(99).default(10),
      minAccountDays: z.number().int().min(0).max(365).default(3),
      alertMultiple: z.number().min(2).max(1000).default(20),
      sharedIpDays: z.number().int().min(1).max(365).default(30),
      /** Swaps (M5c-2): how long one stays open, how many an account keeps open, and the tier gap that warns the admin. */
      tradeDays: z.number().int().min(1).max(30).default(3),
      openTrades: z.number().int().min(1).max(50).default(5),
      tradeAlertTierGap: z.number().int().min(1).max(4).default(3),
    })
    .strict()
    .refine((m) => m.maxPrice >= m.minPrice.legendary, 'maxPrice is at least the legendary floor'),
  /** Clans (GDD §14.3; M5b-1): how many members at most, what creating one costs, and the account level it needs. */
  clans: z
    .object({
      maxMembers: z.number().int().min(5).max(100).default(30),
      createCost: z.object({ coins: z.number().int().min(0).max(100_000_000).default(2000) }).strict().default({ coins: 2000 }),
      minLevel: z.number().int().min(1).max(99).default(5),
      /** How long a kicked account waits to join that clan again or to ask to (M5b-1 review). */
      kickHours: z.number().int().min(0).max(720).default(24),
    })
    .strict(),
  /**
   * The season (GDD §13.1, §14.1; M5a): its id, name and dates (open from `startsAt`, closed from `endsAt`), the points
   * each run adds (per layer, per Core, for extracting), the score of each tier (Bronce to Estelar) and how many rows
   * the leaderboard shows.
   */
  season: z
    .object({
      id: z.string().regex(/^[a-z0-9-]{1,32}$/).default('season-1'),
      name: z.string().min(1).max(40).default('Temporada 1'),
      startsAt: z.iso.datetime().default('2026-11-01T00:00:00.000Z'),
      endsAt: z.iso.datetime().default('2026-12-13T00:00:00.000Z'),
      points: z
        .object({
          layer: z.number().int().min(0).max(100_000).default(10),
          core: z.number().int().min(0).max(100_000).default(50),
          extraction: z.number().int().min(0).max(100_000).default(25),
        })
        .strict()
        .default({ layer: 10, core: 50, extraction: 25 }),
      tiers: z
        .array(z.number().int().min(1).max(100_000_000))
        .length(5)
        .refine((ts) => ts.every((t, i) => i === 0 || t > ts[i - 1]!), 'season_tiers_increasing')
        .default([500, 2000, 6000, 15000, 30000]),
      top: z.number().int().min(3).max(500).default(100),
      /** A run never adds more points than this per minute it lasted. */
      capPerMinute: z.number().int().min(1).max(100_000).default(20),
    })
    .strict()
    .refine((s) => Date.parse(s.startsAt) < Date.parse(s.endsAt), 'season_dates'),
  /**
   * The planetarium (GDD §10.5; M4c-2): its pedestals, the prestige each exhibited galaxy adds by tier (common to
   * legendary) plus one for a finish that is not normal, the experience bonus per point with its cap (never above 5 %),
   * and how many planetariums the featured list shows.
   */
  planetarium: z
    .object({
      // The dome's art has six pedestals: more need new art.
      slots: z.number().int().min(1).max(6).default(6),
      points: z
        .object({
          tiers: z.array(z.number().int().min(0).max(100)).length(5).default([1, 2, 4, 7, 12]),
          finish: z.number().int().min(0).max(100).default(1),
        })
        .strict()
        .default({ tiers: [1, 2, 4, 7, 12], finish: 1 }),
      xpPerPoint: z.number().min(0).max(0.05).default(0.001),
      cap: z.number().min(0).max(0.05).default(0.05),
      featured: z.number().int().min(1).max(24).default(8),
    })
    .strict(),
  /**
   * Sectors (GDD §5.5, §13.1): what opens each sector but the first (stats in the sector the condition names), and the
   * season sector open to everyone now (null: no season open).
   */
  sectors: z
    .object({
      unlocks: z
        .record(
          z.string().regex(/^[a-z0-9-]{1,32}$/),
          z
            .object({
              sector: z.string().regex(/^[a-z0-9-]{1,32}$/),
              stat: z.enum(['bossKills', 'maxDepth', 'extractions']),
              value: z.number().int().min(1).max(1_000_000),
            })
            .strict(),
        )
        .default({
          'frost-rings': { sector: 'outer-nebula', stat: 'bossKills', value: 1 },
          'hollow-reef': { sector: 'frost-rings', stat: 'bossKills', value: 1 },
          'broken-forge': { sector: 'hollow-reef', stat: 'bossKills', value: 1 },
        }),
      season: z.string().regex(/^[a-z0-9-]{1,32}$/).nullable().default('signal-rift'),
    })
    .strict(),
  /**
   * Missions (GDD §12.3; M7a): how many of each pool are drawn for the day and the week (the same for everyone), and the
   * season's fixed list.
   */
  missions: z
    .object({
      daily: z.object({ count: z.number().int().min(0).max(5).default(3), pool: z.array(missionSchema).max(30).prefault(DEFAULT_DAILY) }).strict().prefault({}),
      weekly: z.object({ count: z.number().int().min(0).max(5).default(3), pool: z.array(missionSchema).max(30).prefault(DEFAULT_WEEKLY) }).strict().prefault({}),
      season: z.array(missionSchema).max(30).prefault(DEFAULT_SEASON),
    })
    .strict(),
  /**
   * The season route and shop (GDD §11.1, §13.1; M7d-1): the free ladder climbed with the season score, the season
   * currency (its name, what a run pays per point and the dust each one left is worth at the close) and what it buys.
   */
  seasonRoute: seasonRouteSchema,
  /** The ECN Catalogue's rewards (GDD §12.3; M7b): what completing each share of the album gives, collected once. */
  catalog: z
    .object({
      rewards: z
        .array(catalogRewardSchema)
        .max(10)
        .refine((l) => new Set(l.map((r) => r.percent)).size === l.length, 'Hay dos premios con el mismo porcentaje')
        .prefault(DEFAULT_CATALOG_REWARDS),
    })
    .strict(),
  /** Achievements (GDD §12.3; M7a): lifetime goals that give signals, titles, frames and season points. */
  achievements: z
    .object({
      list: z
        .array(achievementSchema)
        .max(60)
        .refine((l) => new Set(l.map((x) => x.id)).size === l.length, 'Hay dos logros con el mismo id')
        .prefault(DEFAULT_ACHIEVEMENTS),
    })
    .strict(),
  /**
   * Temporary global multipliers (GDD §16.3; M6d-5), «doble polvo el fin de semana»: what a run pays in one currency is
   * multiplied while the window is open (start included, end not). Boosts on one currency multiply, up to ×5 in all.
   */
  boosts: z
    .object({
      list: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9-]{1,32}$/),
              name: z.string().trim().min(1).max(40),
              currency: z.enum(['coins', 'dust', 'material', 'signal']),
              factor: z.number().min(1).max(5),
              startsAt: z.iso.datetime(),
              endsAt: z.iso.datetime(),
            })
            .strict()
            .refine((b) => Date.parse(b.endsAt) > Date.parse(b.startsAt), 'Termina antes de empezar')
            .refine((b) => Date.parse(b.endsAt) - Date.parse(b.startsAt) <= 14 * 86_400_000, 'Dura más de 14 días'),
        )
        .max(10)
        .refine((list) => new Set(list.map((b) => b.id)).size === list.length, 'Hay dos multiplicadores con el mismo id')
        .default([]),
    })
    .strict(),
} as const;

export type ConfigKey = keyof typeof configSchemas;
export type ConfigValue<K extends ConfigKey> = z.output<(typeof configSchemas)[K]>;
export const CONFIG_KEYS = Object.keys(configSchemas) as ConfigKey[];

export function isConfigKey(key: string): key is ConfigKey {
  return Object.hasOwn(configSchemas, key);
}

/**
 * A draft of `key` over what is live (M6b): the fields it names replace theirs whole, the rest stay as published. Only
 * fields the schema knows are kept from what is live, so one removed from the schema never blocks a publish. The
 * server publishes this and the panel checks it, so both always agree. A draft that is not an object stays as it is
 * (and fails its check).
 */
export function mergeDraft(key: ConfigKey, active: unknown, draft: unknown): unknown {
  if (!isPlainObject(draft)) return draft;
  const known = new Set(Object.keys(configSchemas[key].shape));
  const base = isPlainObject(active) ? Object.fromEntries(Object.entries(active).filter(([k]) => known.has(k))) : {};
  return { ...base, ...draft };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * What is wrong with a draft of `key`, each problem at its path and in Spanish (empty when it is valid; M6b). It also
 * refuses what the game cannot serve yet: event banners (GDD §9) have their rules, but not their event signals in the
 * wallet, combined odds on screen or featured checks, so until the events milestone no one can publish half a feature.
 */
export function configIssues(key: ConfigKey, data: unknown): { path: string; message: string }[] {
  const result = configSchemas[key].safeParse(data, { error: esIssues });
  if (!result.success) return result.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
  if (key === 'gacha' && (result.data as ConfigValue<'gacha'>).banners.some((b) => b.kind === 'event')) {
    return [{ path: 'banners', message: 'Los escáneres de evento todavía no se pueden publicar' }];
  }
  return [];
}

/** Valida `data` con el esquema de `key` y devuelve el valor con los valores por defecto aplicados. Lanza si no vale. */
export function parseConfig<K extends ConfigKey>(key: K, data: unknown): ConfigValue<K> {
  if (!isConfigKey(key)) throw new Error(`unknown_config_key:${String(key)}`);
  return configSchemas[key].parse(data) as ConfigValue<K>;
}
