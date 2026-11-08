import { z } from 'zod';
import type { SeasonTier } from './season';
import { FRAMES } from './missions';

// The season route and shop (GDD §11.1, §13.1; M7d-1). The route is a free ladder climbed with the season score: each
// step pays its reward once. Runs that count earn the season currency (a share of their points), the route gives some
// too, and the shop sells with it; when the season closes, what is left becomes dust at an unfavourable rate.

const id = z.string().regex(/^[a-z0-9-]{1,32}$/);
const amount = z.number().int().min(0).max(1_000_000).default(0);
export const seasonRewardSchema = z
  .object({
    coins: amount,
    dust: amount,
    signal: z.number().int().min(0).max(100).default(0),
    shards: z.number().int().min(0).max(100_000).default(0),
    title: z.string().trim().min(1).max(30).nullable().default(null),
    frame: z.enum(FRAMES).nullable().default(null),
  })
  .strict();
export type SeasonReward = z.output<typeof seasonRewardSchema>;

const r = (x: Partial<SeasonReward>): SeasonReward => ({ coins: 0, dust: 0, signal: 0, shards: 0, title: null, frame: null, ...x });

/** Twenty steps up to the Estelar tier (30 000 points by default). */
export const DEFAULT_ROUTE = [
  { at: 100, reward: r({ coins: 300 }) },
  { at: 250, reward: r({ shards: 30 }) },
  { at: 500, reward: r({ signal: 1 }) },
  { at: 800, reward: r({ dust: 400 }) },
  { at: 1200, reward: r({ coins: 800 }) },
  { at: 1600, reward: r({ shards: 60 }) },
  { at: 2000, reward: r({ signal: 2, title: 'Explorador de la Fisura' }) },
  { at: 2600, reward: r({ dust: 800 }) },
  { at: 3300, reward: r({ coins: 1500 }) },
  { at: 4000, reward: r({ shards: 100 }) },
  { at: 5000, reward: r({ signal: 2 }) },
  { at: 6000, reward: r({ dust: 1500, frame: 'nebula' }) },
  { at: 7500, reward: r({ coins: 2500 }) },
  { at: 9000, reward: r({ shards: 150 }) },
  { at: 11000, reward: r({ signal: 3 }) },
  { at: 13000, reward: r({ dust: 2500 }) },
  { at: 15000, reward: r({ coins: 4000, title: 'Purgador de la Estática' }) },
  { at: 19000, reward: r({ shards: 250 }) },
  { at: 24000, reward: r({ signal: 5 }) },
  { at: 30000, reward: r({ signal: 5, dust: 5000, title: 'Leyenda de la Temporada 1' }) },
];

export const DEFAULT_SHOP = [
  { id: 'signal', name: 'Señal de galaxia', price: 60, limit: 20, reward: r({ signal: 1 }) },
  { id: 'dust-bag', name: 'Saco de polvo estelar', price: 40, limit: 10, reward: r({ dust: 500 }) },
  { id: 'coin-bag', name: 'Bolsa de monedas', price: 40, limit: 10, reward: r({ coins: 1500 }) },
  { id: 'title-hunter', name: 'Título Cazador de estática', price: 400, limit: 1, reward: r({ title: 'Cazador de estática' }) },
  { id: 'frame-abyss', name: 'Marco Abismo', price: 900, limit: 1, reward: r({ frame: 'abyss' }) },
];

const stepSchema = z.object({ at: z.number().int().min(1).max(100_000_000), reward: seasonRewardSchema }).strict();
const itemSchema = z
  .object({ id, name: z.string().trim().min(1).max(40), price: z.number().int().min(1).max(1_000_000), limit: z.number().int().min(1).max(1000), reward: seasonRewardSchema })
  .strict();

export const seasonRouteSchema = z
  .object({
    currency: z
      .object({
        name: z.string().trim().min(1).max(24).default('Esquirlas'),
        /** The share of a run's season points it pays in the currency (rounded down). */
        perPoint: z.number().min(0).max(10).default(0.5),
        /** The dust each one left is worth once the season has closed. */
        dustRate: z.number().int().min(0).max(1000).default(2),
      })
      .strict()
      .prefault({}),
    steps: z
      .array(stepSchema)
      .max(60)
      .refine((s) => s.every((x, i) => i === 0 || x.at > s[i - 1]!.at), 'Los escalones tienen que ir de menos a más puntos')
      .prefault(DEFAULT_ROUTE),
    shop: z
      .array(itemSchema)
      .max(30)
      .refine((l) => new Set(l.map((x) => x.id)).size === l.length, 'Hay dos artículos con el mismo id')
      .prefault(DEFAULT_SHOP),
  })
  .strict();

/** The balance that holds a season's currency (it starts from zero every season). */
export const seasonCurrency = (seasonId: string) => `season:${seasonId}`;

/** What a run that counts pays in the season currency for its points. */
export function shardsFor(points: number, perPoint: number): number {
  return Math.max(0, Math.floor(points * perPoint));
}

export interface SeasonView {
  /** Null while no season is open (then the rest is empty). */
  season: { id: string; name: string; endsAt: string; tiers: number[] } | null;
  score: number;
  tier: SeasonTier | null;
  currency: { name: string; balance: number };
  steps: { at: number; reward: SeasonReward; reached: boolean; claimed: boolean }[];
  shop: { id: string; name: string; price: number; limit: number; bought: number; reward: SeasonReward }[];
}

export const seasonStepParamsSchema = z.object({ at: z.coerce.number().int().min(1).max(100_000_000) }).strict();
export const seasonItemParamsSchema = z.object({ id }).strict();
