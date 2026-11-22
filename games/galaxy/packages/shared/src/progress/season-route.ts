import { z } from 'zod';
import type { SeasonTier } from './season';
import { FRAMES } from './missions';
import { ART_AVATARS, ART_SKINS, type CosmeticsConfig, type SkinId } from '../cosmetics/catalog';
import type { MailLimits } from '../gifts/limits';
import { type BigGiftReason, bigGiftReasons, galaxyCount, MAX_GALAXIES } from '../gifts/rules';
import { type Gift, giftListSchema } from '../gifts/schema';

// The season route and shop (GDD §11.1, §13.1; M7d-1). The route is a free ladder climbed with the season score: each
// step pays its reward once. Runs that count earn the season currency (a share of their points), the route gives some
// too, and the shop sells with it; when the season closes, what is left becomes dust at an unfavourable rate. Since
// PR 4 of «temporadas como fichas» (2026-11-22) every step, item and closing prize also carries gifts of any kind
// (`gifts`, the mail's: galaxies, probes, skins…) next to its old `reward`, which still holds and is still paid; and the
// close pays by place too, in ranges (`closing.places`), to those who can win prizes for their place.

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
    avatar: z.enum(ART_AVATARS).nullable().default(null),
    /** Plan «skins», part C: a probe skin (the Aurora collection rides the route). */
    skin: z.enum(ART_SKINS as [SkinId, ...SkinId[]]).nullable().default(null),
  })
  .strict();
export type SeasonReward = z.output<typeof seasonRewardSchema>;

const r = (x: Partial<SeasonReward>): SeasonReward => ({ coins: 0, dust: 0, signal: 0, shards: 0, title: null, frame: null, avatar: null, skin: null, ...x });

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

/** What each tier pays when the season closes (Bronce to Estelar), and the podium's extra (GDD §13.1). */
export const DEFAULT_CLOSING_TIERS = [
  r({ coins: 500, signal: 1 }),
  r({ coins: 1500, dust: 300, signal: 2 }),
  r({ coins: 3000, dust: 800, signal: 4, frame: 'bronze' }),
  r({ coins: 5000, dust: 1500, signal: 6, title: 'Platino de temporada' }),
  r({ coins: 8000, dust: 3000, signal: 10, title: 'Estelar de temporada', frame: 'nebula' }),
];
export const DEFAULT_PODIUM = r({ signal: 10, title: 'Podio de temporada', frame: 'crown' });

/** A reward that gives nothing (what a step, item or place made only of gifts keeps as its old reward). */
export const EMPTY_SEASON_REWARD: SeasonReward = r({});

/** The gifts of a step, an item or a prize: at most 20, and no more galaxies than one message carries. */
const giftsField = giftListSchema(20)
  .default([])
  .refine((g) => galaxyCount(g) <= MAX_GALAXIES, 'season_gift_galaxies');

const reward = seasonRewardSchema.prefault({});
const stepSchema = z.object({ at: z.number().int().min(1).max(100_000_000), reward, gifts: giftsField }).strict();
const itemSchema = z
  .object({ id, name: z.string().trim().min(1).max(40), price: z.number().int().min(1).max(1_000_000), limit: z.number().int().min(1).max(1000), reward, gifts: giftsField })
  .strict();

/** A range of places of the close (1 = the first among those who can win prizes for their place) and its gifts. */
export const seasonPlaceSchema = z.object({ from: z.number().int().min(1).max(10_000), to: z.number().int().min(1).max(10_000), gifts: giftsField }).strict();
export type SeasonPlace = z.output<typeof seasonPlaceSchema>;

/** The places' rules, as a tournament's prizes: from the first, in order, never overlapping, each one giving something. */
function checkPlaces(places: readonly SeasonPlace[], ctx: z.RefinementCtx): void {
  places.forEach((p, i) => {
    if (p.from > p.to) ctx.addIssue({ code: 'custom', path: [i, 'to'], message: 'prize_range' });
    if (p.gifts.length === 0) ctx.addIssue({ code: 'custom', path: [i], message: 'prize_empty' });
    const prev = places[i - 1];
    if (prev && p.from < prev.from) ctx.addIssue({ code: 'custom', path: [i, 'from'], message: 'prizes_order' });
    else if (prev && p.from <= prev.to) ctx.addIssue({ code: 'custom', path: [i, 'from'], message: 'prizes_overlap' });
  });
  if (places[0] && places[0].from !== 1) ctx.addIssue({ code: 'custom', path: [0, 'from'], message: 'prizes_start' });
}

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
    /**
     * What the season's close pays: by tier (`tiers`, and the gifts of each in `tierGifts`), the podium's extra (the
     * first `podiumSize` places, with a trophy) and, by place, each range's gifts (`places`).
     */
    closing: z
      .object({
        tiers: z.array(seasonRewardSchema).length(5).prefault(DEFAULT_CLOSING_TIERS),
        podium: seasonRewardSchema.prefault(DEFAULT_PODIUM),
        podiumSize: z.number().int().min(0).max(10).default(3),
        tierGifts: z.array(giftsField).length(5).prefault([[], [], [], [], []]),
        podiumGifts: giftsField,
        places: z.array(seasonPlaceSchema).max(20).default([]).superRefine(checkPlaces),
      })
      .strict()
      // One claim pays a player's tier, the podium's extra and their place together: never more galaxies than a message
      // carries (each is made on the spot, in the one Node process).
      .superRefine((c, ctx) => {
        const most = (lists: readonly (readonly Gift[])[]) => lists.reduce((m, g) => Math.max(m, galaxyCount(g)), 0);
        const worst = most(c.tierGifts) + (c.podiumSize > 0 ? galaxyCount(c.podiumGifts) : 0) + most(c.places.map((p) => p.gifts));
        if (worst > MAX_GALAXIES) ctx.addIssue({ code: 'custom', path: [], message: 'season_closing_galaxies' });
      })
      .prefault({}),
  })
  .strict();

/** The balance that holds a season's currency (it starts from zero every season). */
export const seasonCurrency = (seasonId: string) => `season:${seasonId}`;

type SeasonRoute = z.output<typeof seasonRouteSchema>;
type Closing = SeasonRoute['closing'];
const SEASON_ID = /^[a-z0-9-]{1,32}$/;

/**
 * An old reward as gifts, to show it the way the new ones are (it is still paid as it is): its currencies, the season's
 * own (`shards`, only with the season's id: a closing prize never paid it) and each piece. A title is its own text.
 */
export function seasonRewardToGifts(reward: SeasonReward, seasonId: string | null): Gift[] {
  const out: Gift[] = [];
  for (const currency of ['coins', 'dust', 'signal'] as const) if (reward[currency] > 0) out.push({ kind: 'currency', currency, amount: reward[currency] });
  if (reward.shards > 0 && seasonId && SEASON_ID.test(seasonId)) out.push({ kind: 'currency', currency: seasonCurrency(seasonId) as `season:${string}`, amount: reward.shards });
  if (reward.title) out.push({ kind: 'cosmetic', piece: 'title', id: reward.title });
  if (reward.frame) out.push({ kind: 'cosmetic', piece: 'frame', id: reward.frame });
  if (reward.avatar) out.push({ kind: 'cosmetic', piece: 'avatar', id: reward.avatar });
  if (reward.skin) out.push({ kind: 'cosmetic', piece: 'skin', id: reward.skin });
  return out;
}

/** Whether an old reward gives anything. */
export const rewardGivesAnything = (reward: SeasonReward) => seasonRewardToGifts(reward, 'x').length > 0;

/** The range a prize place falls in (1 = the first among those who can win), or null when it wins nothing. */
export function seasonPlaceOf(places: readonly SeasonPlace[], place: number): SeasonPlace | null {
  return places.find((p) => p.from <= place && place <= p.to) ?? null;
}

/**
 * The prize place of each account, in ranking order, up to `last`: places go to those who can win prizes for their
 * place; one who cannot keeps its rank (with its mark) and its place passes to the next one [U].
 */
export function seasonPrizePlaces(rows: readonly { accountId: string }[], ineligible: ReadonlySet<string>, last: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (out.size >= last) break;
    if (!ineligible.has(r.accountId)) out.set(r.accountId, out.size + 1);
  }
  return out;
}

/** The prizes of a season's close (GDD §13.1), as the leaderboard shows them. */
export interface SeasonClosingInfo {
  tiers: SeasonReward[];
  podium: SeasonReward;
  podiumSize: number;
  tierGifts: Gift[][];
  podiumGifts: Gift[];
  places: SeasonPlace[];
}

/** What the leaderboard shows of a season's close: every prize, by tier, podium and place. */
export function closingInfo(c: Closing): SeasonClosingInfo {
  return { tiers: [...c.tiers], podium: c.podium, podiumSize: c.podiumSize, tierGifts: c.tierGifts.map((g) => [...g]), podiumGifts: [...c.podiumGifts], places: c.places.map((p) => ({ ...p, gifts: [...p.gifts] })) };
}

/** Each list of gifts of a route, with its path in a record and whether it is paid while the season is open. */
export function seasonGiftLists(route: SeasonRoute): { path: string; gifts: readonly Gift[]; open: boolean }[] {
  return [
    ...route.steps.map((s, i) => ({ path: `route.steps.${i}.gifts`, gifts: s.gifts, open: true })),
    ...route.shop.map((s, i) => ({ path: `route.shop.${i}.gifts`, gifts: s.gifts, open: true })),
    ...route.closing.tierGifts.map((g, i) => ({ path: `route.closing.tierGifts.${i}`, gifts: g, open: false })),
    { path: 'route.closing.podiumGifts', gifts: route.closing.podiumGifts, open: false },
    ...route.closing.places.map((p, i) => ({ path: `route.closing.places.${i}.gifts`, gifts: p.gifts, open: false })),
  ];
}

/** Every player: what the route, the shop and the tiers reach (a tournament's participation prize counts the same). */
const EVERYONE = Number.MAX_SAFE_INTEGER;

/** A shop item's gifts for all the times one player can buy it. */
function timesLimit(gifts: readonly Gift[], limit: number): Gift[] {
  return gifts.map((g) => (g.kind === 'currency' || g.kind === 'xp' || g.kind === 'seasonPoints' ? { ...g, amount: g.amount * limit } : g.kind === 'galaxy' ? { ...g, count: g.count * limit } : g));
}

/**
 * Why scheduling a season needs a superadmin (the mail's limits, `bigGiftReasons`): each step, each item (for all the
 * times a player can buy it) and each closing prize, old rewards included, weighed like a message to as many players
 * as it reaches (the route, the shop and the tiers, everyone; the podium its places; a range as many as it has).
 */
export function seasonBigGifts(route: SeasonRoute, limits: MailLimits, cosmetics: CosmeticsConfig): { path: string; reasons: BigGiftReason[] }[] {
  const all = (reward: SeasonReward, gifts: readonly Gift[]) => [...seasonRewardToGifts(reward, 'x'), ...gifts];
  const lists: { path: string; gifts: Gift[]; recipients: number }[] = [
    ...route.steps.map((s, i) => ({ path: `route.steps.${i}`, gifts: all(s.reward, s.gifts), recipients: EVERYONE })),
    ...route.shop.map((s, i) => ({ path: `route.shop.${i}`, gifts: timesLimit(all(s.reward, s.gifts), s.limit), recipients: EVERYONE })),
    ...route.closing.tiers.map((t, i) => ({ path: `route.closing.tiers.${i}`, gifts: all(t, route.closing.tierGifts[i] ?? []), recipients: EVERYONE })),
    ...(route.closing.podiumSize > 0 ? [{ path: 'route.closing.podium', gifts: all(route.closing.podium, route.closing.podiumGifts), recipients: route.closing.podiumSize }] : []),
    ...route.closing.places.map((p, i) => ({ path: `route.closing.places.${i}`, gifts: [...p.gifts], recipients: p.to - p.from + 1 })),
  ];
  return lists.flatMap((l) => {
    const reasons = l.gifts.length > 0 ? bigGiftReasons(l.gifts, l.recipients, limits, cosmetics) : [];
    return reasons.length > 0 ? [{ path: l.path, reasons }] : [];
  });
}

/**
 * A route for season `to` (a copy of another season's, an import, an id changed): any season currency its steps and
 * items give becomes `to`'s own, the only one they may give. Unchanged without a valid id.
 */
export function retargetSeasonGifts(route: SeasonRoute, to: string): SeasonRoute {
  if (!SEASON_ID.test(to)) return route;
  const own = seasonCurrency(to) as `season:${string}`;
  const stale = (gifts: readonly Gift[]) => gifts.some((g) => g.kind === 'currency' && g.currency.startsWith('season:') && g.currency !== own);
  if (![...route.steps, ...route.shop].some((x) => stale(x.gifts))) return route;
  const move = (gifts: readonly Gift[]): Gift[] => gifts.map((g) => (g.kind === 'currency' && g.currency.startsWith('season:') ? { ...g, currency: own } : g));
  return {
    ...route,
    steps: route.steps.map((s) => ({ ...s, gifts: move(s.gifts) })),
    shop: route.shop.map((s) => ({ ...s, gifts: move(s.gifts) })),
  };
}

/**
 * A prize of a season's close as it is kept with its result (`season_results.rewards`): its old reward, and since PR 4
 * its gifts and, for a range of places, which one. A result kept before reads as an old reward with no gifts.
 */
export type SeasonPrize = SeasonReward & { gifts?: Gift[]; place?: { from: number; to: number } };

/** What a run that counts pays in the season currency for its points. */
export function shardsFor(points: number, perPoint: number): number {
  return Math.max(0, Math.floor(points * perPoint));
}

/** An account's place when a season closed (M7d-2): its rewards, kept from that close, are collected once. */
export interface SeasonResult {
  season: string;
  name: string;
  endsAt: string;
  rank: number;
  score: number;
  tier: SeasonTier | null;
  /** On the podium: a trophy for the station. */
  podium: boolean;
  rewards: SeasonPrize[];
  claimed: boolean;
}

/** The hall of fame (M7d-2): every closed season, newest first, with its podium. */
export interface HallOfFame {
  seasons: { season: string; name: string; endsAt: string; players: number; podium: { username: string; rank: number; score: number }[] }[];
}

/** A player's past seasons (M7d-2), newest first: public, like the profile. */
export interface SeasonHistory {
  seasons: Omit<SeasonResult, 'rewards' | 'claimed'>[];
}

export interface SeasonView {
  /** Null while no season is open (then the rest is empty). */
  season: { id: string; name: string; startsAt: string; endsAt: string; tiers: number[] } | null;
  score: number;
  tier: SeasonTier | null;
  currency: { name: string; balance: number };
  /** Each step's and item's old reward and its gifts (PR 4; the server always sends them, absent reads as none). */
  steps: { at: number; reward: SeasonReward; gifts?: Gift[]; reached: boolean; claimed: boolean }[];
  shop: { id: string; name: string; price: number; limit: number; bought: number; reward: SeasonReward; gifts?: Gift[] }[];
  /** The last closed season's result while its rewards are still to collect (M7d-2). */
  closing: SeasonResult | null;
}

export const seasonStepParamsSchema = z.object({ at: z.coerce.number().int().min(1).max(100_000_000) }).strict();
export const seasonItemParamsSchema = z.object({ id }).strict();
export const seasonResultParamsSchema = z.object({ season: id }).strict();
