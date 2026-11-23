import { z } from 'zod';
import { type CosmeticsConfig, skinParts } from '../cosmetics/catalog';
import type { MailLimits } from '../gifts/limits';
import { type BigGiftReason, bigGiftReasons, type GiftIssueCode, giftIssues, type GiftLive } from '../gifts/rules';
import { type Gift, giftListSchema } from '../gifts/schema';
import { choiceGifts } from './choice';

// Tournaments (plan «temporadas como fichas», part 5; GDD §13.3): competitions an admin prepares inside a season, each
// with its own ranking by the measure the admin picks, optional filters, an optional entry fee in game currency and
// prizes by place (gifts of any kind, skins the winner chooses and, apart, money an admin pays outside the game). Pure:
// the panel shows the same problems the server enforces.

/** What a tournament ranks by (GDD §13.3): its own ranking over the runs that count, never missions or adjustments. */
export const TOURNAMENT_METRICS = ['points', 'kills', 'runs', 'best_run', 'depth', 'cores', 'extractions', 'season_points'] as const;
export type TournamentMetric = (typeof TOURNAMENT_METRICS)[number];

/**
 * Its life: a draft (being prepared, invisible), scheduled (sign-up open), running, in review (ended: its prize places'
 * runs are replayed and an admin may step in), finished (results published, prizes to collect) or cancelled (fees back).
 */
export const TOURNAMENT_STATES = ['draft', 'scheduled', 'running', 'review', 'finished', 'cancelled'] as const;
export type TournamentState = (typeof TOURNAMENT_STATES)[number];

export const TOURNAMENT_MODES = ['solo', 'coop', 'any'] as const;
export type TournamentMode = (typeof TOURNAMENT_MODES)[number];

/** The longest a tournament lasts [U]: a whole month (the owner, 2026-11-23, for the Torneo Navideño). */
export const TOURNAMENT_MAX_DAYS = 31;
/** The currencies an entry fee can be paid in (the wallet's own; never a season's or an event's). */
export const TOURNAMENT_FEE_CURRENCIES = ['coins', 'dust', 'signal'] as const;

const id = z.string().regex(/^[a-z0-9-]{1,32}$/);

export const tournamentFiltersSchema = z
  .object({
    /** Only runs in this sector. */
    sector: id.nullable().default(null),
    /** Only runs with this probe. */
    probe: id.nullable().default(null),
    /** Only solo runs, only group runs, or both. */
    mode: z.enum(TOURNAMENT_MODES).default('any'),
    /** The account level it takes to sign up. */
    minLevel: z.number().int().min(1).max(99).nullable().default(null),
  })
  .strict();
export type TournamentFilters = z.output<typeof tournamentFiltersSchema>;

export const tournamentFeeSchema = z.object({ currency: z.enum(TOURNAMENT_FEE_CURRENCIES), amount: z.number().int().min(1).max(1_000_000) }).strict();
export type TournamentFee = z.output<typeof tournamentFeeSchema>;

/** Euros with at most two decimals. */
const euros = z
  .number()
  .positive()
  .max(100_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: 'cash_cents' });

/** Money for a place: never paid in the game; an admin pays it outside and marks it paid (audited). */
export const cashPrizeSchema = z.object({ amountEur: euros, note: z.string().trim().max(200).default('') }).strict();
export type CashPrize = z.output<typeof cashPrizeSchema>;

/** The most options, and skins, a choice holds (a pack is eight). */
export const PRIZE_CHOICE_MAX = 12;

/**
 * Skins the winner chooses when they collect (plan «Torneo Navideño», C1): `count` among `options` (`count` equal to the
 * options: all of them, nothing to choose). The ones they already have, or that are off by then, cannot be given; each
 * one short of `count` pays `perMissing` (null: nothing). Whether each option exists is checked by tournamentIssues, never
 * here: a stored tournament must keep reading even if a skin goes away.
 */
export const prizeChoiceSchema = z
  .object({
    piece: z.literal('skin'),
    options: z
      .array(z.string().regex(/^[a-z0-9-]{1,60}$/))
      .min(1)
      .max(PRIZE_CHOICE_MAX),
    count: z.number().int().min(1).max(PRIZE_CHOICE_MAX),
    perMissing: tournamentFeeSchema.nullable(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.count > c.options.length) ctx.addIssue({ code: 'custom', path: ['count'], message: 'prize_choice_count' });
    const seen = new Set<string>();
    c.options.forEach((id, k) => {
      if (seen.has(id)) ctx.addIssue({ code: 'custom', path: ['options', k], message: 'prize_choice_twice' });
      seen.add(id);
    });
  });
export type PrizeChoice = z.output<typeof prizeChoiceSchema>;

export const prizeRangeSchema = z
  .object({
    from: z.number().int().min(1).max(10_000),
    to: z.number().int().min(1).max(10_000),
    gifts: giftListSchema(20).default([]),
    cash: cashPrizeSchema.nullable().default(null),
    /** Optional, never defaulted: records saved before keep exactly their shape. */
    choice: prizeChoiceSchema.optional(),
  })
  .strict();
export type PrizeRange = z.output<typeof prizeRangeSchema>;

/** A prize for everyone who played at least `minRuns` runs that count. */
export const participationSchema = z.object({ minRuns: z.number().int().min(1).max(1000), gifts: giftListSchema(20).min(1) }).strict();
export type Participation = z.output<typeof participationSchema>;

const DAY_MS = 86_400_000;

/** A tournament as an admin saves it (its id, state and version are the server's). */
export const tournamentRecordSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,46})[a-z0-9]$/),
    /** The season that holds it (a season record: scheduled, and its dates around the tournament's). */
    seasonId: id,
    title: z.string().trim().min(1).max(60),
    summary: z.string().trim().max(200).default(''),
    rules: z.string().trim().max(4000).default(''),
    /** Images uploaded in Administración (galaxy.media_assets): the card's banner and the page's prize picture. */
    bannerMedia: z.uuid().nullable().default(null),
    detailsMedia: z.uuid().nullable().default(null),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    /** Exclusive: no one is in two exclusive tournaments whose dates overlap. */
    exclusive: z.boolean().default(true),
    metric: z.enum(TOURNAMENT_METRICS),
    filters: tournamentFiltersSchema.prefault({}),
    entry: tournamentFeeSchema.nullable().default(null),
    prizes: z.array(prizeRangeSchema).max(20).default([]),
    participation: participationSchema.nullable().default(null),
    /** Hours between the end and the results at the least (they wait longer while a check is pending). */
    reviewHours: z.number().int().min(0).max(168).default(24),
    maxEntrants: z.number().int().min(1).max(100_000).nullable().default(null),
  })
  .strict()
  .superRefine((t, ctx) => {
    const span = Date.parse(t.endsAt) - Date.parse(t.startsAt);
    if (span <= 0) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'tournament_dates' });
    else if (span > TOURNAMENT_MAX_DAYS * DAY_MS) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'tournament_too_long' });
    t.prizes.forEach((p, i) => {
      if (p.from > p.to) ctx.addIssue({ code: 'custom', path: ['prizes', i, 'to'], message: 'prize_range' });
      if (p.gifts.length === 0 && !p.cash && !p.choice) ctx.addIssue({ code: 'custom', path: ['prizes', i], message: 'prize_empty' });
      const prev = t.prizes[i - 1];
      if (prev && p.from < prev.from) ctx.addIssue({ code: 'custom', path: ['prizes', i, 'from'], message: 'prizes_order' });
      else if (prev && p.from <= prev.to) ctx.addIssue({ code: 'custom', path: ['prizes', i, 'from'], message: 'prizes_overlap' });
    });
    if (t.prizes[0] && t.prizes[0].from !== 1) ctx.addIssue({ code: 'custom', path: ['prizes', 0, 'from'], message: 'prizes_start' });
    // Money is never at stake for a fee [U]: a paid entry and a cash prize never go together.
    if (t.entry && t.prizes.some((p) => p.cash)) ctx.addIssue({ code: 'custom', path: ['entry'], message: 'entry_with_cash' });
  });
export type TournamentRecordInput = z.input<typeof tournamentRecordSchema>;
export type TournamentRecord = z.output<typeof tournamentRecordSchema>;

/** The copy keys of a record's problems (their Spanish text lives in the web, `copy.tournamentIssues`). */
export const TOURNAMENT_ISSUE_CODES = [
  'tournament_dates',
  'tournament_too_long',
  'prize_range',
  'prize_empty',
  'prize_choice_count',
  'prize_choice_twice',
  'prizes_order',
  'prizes_overlap',
  'prizes_start',
  'entry_with_cash',
  'cash_cents',
  'tournament_season_unknown',
  'tournament_season_closed',
  'tournament_outside_season',
  'tournament_sector_unknown',
  'tournament_probe_unknown',
  'tournament_end_past',
  'tournament_slug_taken',
  'tournament_media_unknown',
  'prize_gift_seasonal',
  'prize_gift_event',
] as const;
export type TournamentIssueCode = (typeof TOURNAMENT_ISSUE_CODES)[number] | `gift_${GiftIssueCode}`;

export interface TournamentIssue {
  path: string;
  message: string;
}

/** What a record is checked against: its season, the content's sectors and probes, and what gifts can be given. */
export interface TournamentContext {
  /** The record's season (undefined: not checked; null: no such season). */
  season?: { id: string; state: 'draft' | 'scheduled' | 'closed'; startsAt: string; endsAt: string } | null;
  sectors?: readonly string[];
  probes?: readonly string[];
  /** What is live for the gifts (cosmetics, probes, galaxies that can be made); absent: not checked. */
  gifts?: GiftLive;
}

/**
 * Whether a tournament's dates lie inside its season's (both edges included): what scheduling one checks, and what moving
 * a season's dates must keep for the tournaments it already holds.
 */
export function tournamentFitsSeason(t: { startsAt: string; endsAt: string }, s: { startsAt: string; endsAt: string }): boolean {
  return Date.parse(t.startsAt) >= Date.parse(s.startsAt) && Date.parse(t.endsAt) <= Date.parse(s.endsAt);
}

/** Every gift of a record with its path: each range's and the participation prize's. */
function giftsOf(t: TournamentRecord): { path: string; gifts: readonly Gift[] }[] {
  return [...t.prizes.map((p, i) => ({ path: `prizes.${i}.gifts`, gifts: p.gifts })), ...(t.participation ? [{ path: 'participation.gifts', gifts: t.participation.gifts }] : [])];
}

/**
 * Everything that keeps a record from being saved or scheduled, as `{ path, message }` (copy keys). A tournament's
 * prizes are collected whenever its winner comes for them (they never expire), so nothing that ends with the season or
 * an event can be one.
 */
export function tournamentIssues(input: unknown, ctx: TournamentContext = {}): TournamentIssue[] {
  const parsed = tournamentRecordSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
  const t = parsed.data;
  const out: TournamentIssue[] = [];
  if (ctx.season !== undefined) {
    const s = ctx.season;
    if (!s || s.id !== t.seasonId) out.push({ path: 'seasonId', message: 'tournament_season_unknown' });
    else if (s.state !== 'scheduled') out.push({ path: 'seasonId', message: 'tournament_season_closed' });
    else if (!tournamentFitsSeason(t, s)) out.push({ path: 'startsAt', message: 'tournament_outside_season' });
  }
  if (ctx.sectors && t.filters.sector && !ctx.sectors.includes(t.filters.sector)) out.push({ path: 'filters.sector', message: 'tournament_sector_unknown' });
  if (ctx.probes && t.filters.probe && !ctx.probes.includes(t.filters.probe)) out.push({ path: 'filters.probe', message: 'tournament_probe_unknown' });
  for (const { path, gifts } of giftsOf(t)) {
    gifts.forEach((g, i) => {
      if (g.kind === 'seasonPoints' || (g.kind === 'currency' && g.currency.startsWith('season:'))) out.push({ path: `${path}.${i}`, message: 'prize_gift_seasonal' });
      else if (g.kind === 'currency' && g.currency.startsWith('signal:')) out.push({ path: `${path}.${i}`, message: 'prize_gift_event' });
    });
    if (ctx.gifts) {
      const live = ctx.gifts;
      // Seasonal and event gifts are refused above; the rest as the mail checks them.
      for (const issue of giftIssues(gifts, live)) if (issue.code !== 'season_closed' && issue.code !== 'event_closed') out.push({ path: `${path}.${issue.index}`, message: `gift_${issue.code}` });
    }
  }
  // Skins to choose: each option a skin with art and, against what is live, one that can be given.
  t.prizes.forEach((p, i) =>
    p.choice?.options.forEach((id, k) => {
      const path = `prizes.${i}.choice.options.${k}`;
      if (!skinParts(id)) out.push({ path, message: 'gift_cosmetic_unknown' });
      else if (ctx.gifts) for (const issue of giftIssues([{ kind: 'cosmetic', piece: 'skin', id }], ctx.gifts)) out.push({ path, message: `gift_${issue.code}` });
    }),
  );
  return out;
}

/** The prize range of a place (1 = first), or null when that place wins nothing. */
export function prizeForPlace(prizes: readonly PrizeRange[], place: number): PrizeRange | null {
  return prizes.find((p) => p.from <= place && place <= p.to) ?? null;
}

/** The last place that wins something (0 without prizes). */
export function lastPrizePlace(prizes: readonly PrizeRange[]): number {
  return prizes.reduce((m, p) => Math.max(m, p.to), 0);
}

/**
 * The prize place of each account that wins one, in ranking order: places go to the accounts that can win prizes, in
 * their ranking order; an account that cannot keeps its rank (with a mark) and its place passes to the next one [U].
 */
export function awardPlaces(rows: readonly { accountId: string; eligible: boolean }[], prizes: readonly PrizeRange[]): Map<string, number> {
  const out = new Map<string, number>();
  const last = lastPrizePlace(prizes);
  let place = 0;
  for (const r of rows) {
    if (place >= last) break;
    if (!r.eligible) continue;
    place++;
    if (prizeForPlace(prizes, place)) out.set(r.accountId, place);
  }
  return out;
}

/** What an entrant takes from a finished tournament (frozen in its entry when the results are published). */
export interface TournamentRewards {
  /** Its prize place among those who can win (null: none). */
  place: number | null;
  /** Its place's gifts, then the participation prize's. */
  gifts: Gift[];
  /** Money for its place, paid outside the game. */
  cash: CashPrize | null;
  /** It played enough for the participation prize. */
  participation: boolean;
  /** Its place's skins to choose, frozen with the results (absent: none, and in results published before they existed). */
  choice?: PrizeChoice;
  /** Collected: the skins the choice gave, in the options' order. */
  chosen?: string[];
  /** Collected: how many skins of the choice could not be given (each one paid with its `perMissing`). */
  missing?: number;
}

/** What an entrant takes: its place's prize and the participation prize; null when nothing (or it cannot win prizes). */
export function tournamentRewardsFor(t: Pick<TournamentRecord, 'prizes' | 'participation'>, who: { place: number | null; runs: number; eligible: boolean }): TournamentRewards | null {
  if (!who.eligible) return null;
  const range = who.place !== null ? prizeForPlace(t.prizes, who.place) : null;
  const participation = !!t.participation && who.runs >= t.participation.minRuns;
  const gifts = [...(range?.gifts ?? []), ...(participation ? t.participation!.gifts : [])];
  const cash = range?.cash ?? null;
  const choice = range?.choice;
  if (gifts.length === 0 && !cash && !choice) return null;
  // The key only when there is a choice: everything else keeps the shape it always had.
  return { place: range ? who.place : null, gifts, cash, participation, ...(choice ? { choice } : {}) };
}

export type TournamentBigReason = BigGiftReason | 'cash';

/**
 * Why scheduling a record needs a superadmin: any prize past the mail's limits for a superadmin, or any money. Each
 * winner takes their place's gifts and the participation prize together, so a range is weighed with it (to as many
 * players as places it has); the participation prize alone, to the cap (or to anyone when there is none). Skins to
 * choose weigh as every option given and, at their most, `count` skins paid with `perMissing`.
 */
export function tournamentBigReasons(t: Pick<TournamentRecord, 'prizes' | 'participation' | 'maxEntrants'>, limits: MailLimits, cosmetics: CosmeticsConfig): TournamentBigReason[] {
  const out = new Set<TournamentBigReason>();
  const extra = t.participation?.gifts ?? [];
  for (const p of t.prizes) {
    if (p.cash) out.add('cash');
    const c = p.choice;
    const own: Gift[] = [...p.gifts, ...(c ? choiceGifts(c) : []), ...(c?.perMissing ? [{ kind: 'currency' as const, currency: c.perMissing.currency, amount: c.perMissing.amount * c.count }] : [])];
    if (own.length > 0) for (const r of bigGiftReasons([...own, ...extra], p.to - p.from + 1, limits, cosmetics)) out.add(r);
  }
  if (t.participation) for (const r of bigGiftReasons(t.participation.gifts, t.maxEntrants ?? Number.MAX_SAFE_INTEGER, limits, cosmetics)) out.add(r);
  return [...out];
}

/** Whether two date ranges overlap (each from its start, included, to its end, excluded). */
export function datesOverlap(a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }): boolean {
  return Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);
}

/** What one run adds to a metric (its points are the season's formula for that run; `extracted` its outcome). */
export function runContribution(metric: TournamentMetric, run: { points: number; kills: number; depth: number; cores: number; extracted: boolean }): number {
  switch (metric) {
    case 'points':
    case 'season_points':
    case 'best_run':
      return run.points;
    case 'kills':
      return run.kills;
    case 'runs':
      return 1;
    case 'depth':
      return run.depth;
    case 'cores':
      return run.cores;
    case 'extractions':
      return run.extracted ? 1 : 0;
  }
}
