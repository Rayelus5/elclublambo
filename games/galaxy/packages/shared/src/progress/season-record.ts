import { z } from 'zod';
import { type ConfigValue, configSchemas, labNodeSchema, parseConfig } from '../config/registry';
import type { CosmeticsConfig } from '../cosmetics/catalog';
import { giftIssues } from '../gifts/rules';
import { missionSchema } from './missions';
import type { SeasonConfig } from './season';
import { rewardGivesAnything, seasonCurrency, seasonGiftLists, seasonRouteSchema } from './season-route';

// Seasons as records (plan «temporadas como fichas», 2026-11-21; GDD §13.1). A season stops being the single live key
// `season` (with `seasonRoute`, `missions.season` and `lab.season`) and becomes a record with all of it: its dates, its
// rules (what the key `season` held besides id, name and dates), its route and shop, its own missions and its seasonal
// lab tree. Past, current and upcoming seasons live side by side; the one a moment belongs to is the scheduled season
// open then, or, between two seasons, the last that ended (its name and currency still show, nothing is open).

export const SEASON_STATES = ['draft', 'scheduled', 'closed'] as const;
export type SeasonState = (typeof SEASON_STATES)[number];

/** The season's rules: what the live key `season` holds besides its id, name and dates. */
export type SeasonRules = Omit<SeasonConfig, 'id' | 'name' | 'startsAt' | 'endsAt'>;

const OWN_FIELDS = ['id', 'name', 'startsAt', 'endsAt'] as const;

const madrid = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** True when the instant is exactly 00:00:00 in Madrid (seasons and events start and end there; CONTENIDO B). */
export function isMadridMidnight(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t % 1000 === 0 && madrid.format(new Date(t)) === '00:00:00';
}

/**
 * A season record as it is saved and imported (`temporada.json` in an ops folder). The rules are checked with the key
 * `season`'s own schema (with the record's id, name and dates), so they mean exactly what they meant there.
 */
export const seasonRecordSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,32}$/),
    name: z.string().trim().min(1).max(40),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    rules: z.record(z.string(), z.unknown()).default({}),
    route: seasonRouteSchema.prefault({}),
    missions: z.array(missionSchema).max(30).default([]),
    lab: z.array(labNodeSchema).max(120).default([]),
  })
  .strict()
  .superRefine((r, ctx) => {
    for (const f of OWN_FIELDS) if (f in r.rules) ctx.addIssue({ code: 'custom', path: ['rules', f], message: `season_rules_field:${f}` });
    const season = configSchemas.season.safeParse({ ...r.rules, id: r.id, name: r.name, startsAt: r.startsAt, endsAt: r.endsAt });
    if (!season.success) {
      for (const i of season.error.issues) {
        // The dates belong to the record itself; everything else is a rule.
        const own = i.path.length === 0 || OWN_FIELDS.includes(i.path[0] as (typeof OWN_FIELDS)[number]);
        ctx.addIssue({ code: 'custom', path: own ? [...i.path] : ['rules', ...i.path], message: i.message });
      }
    }
    for (const f of ['startsAt', 'endsAt'] as const) if (!isMadridMidnight(r[f])) ctx.addIssue({ code: 'custom', path: [f], message: 'season_midnight' });
    const seen = new Set<string>();
    for (const m of r.missions) {
      if (seen.has(m.id)) ctx.addIssue({ code: 'custom', path: ['missions'], message: `mission_duplicate:${m.id}` });
      seen.add(m.id);
    }
    // What a season's gifts may give (PR 4): while it is open, its own currency but never another season's nor season
    // points (points that pay steps that pay points); at its close, nothing seasonal (it is collected once it is over).
    const own = seasonCurrency(r.id);
    for (const list of seasonGiftLists(r.route)) {
      list.gifts.forEach((g, i) => {
        const path = [...list.path.split('.'), i];
        const seasonal = g.kind === 'seasonPoints' || (g.kind === 'currency' && g.currency.startsWith('season:'));
        if (!list.open && seasonal) ctx.addIssue({ code: 'custom', path, message: 'season_gift_closed' });
        else if (list.open && g.kind === 'seasonPoints') ctx.addIssue({ code: 'custom', path, message: 'season_gift_points' });
        else if (list.open && g.kind === 'currency' && g.currency.startsWith('season:') && g.currency !== own) ctx.addIssue({ code: 'custom', path, message: 'season_gift_other' });
      });
    }
  });
export type SeasonRecordInput = z.input<typeof seasonRecordSchema>;

/** A record as the code reads it: its rules complete (the key `season`'s defaults filled in). */
export interface SeasonRecordData {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  rules: SeasonRules;
  route: ConfigValue<'seasonRoute'>;
  missions: z.output<typeof missionSchema>[];
  lab: z.output<typeof labNodeSchema>[];
}

/** The live key `season` this record stands for: its rules with its id, name and dates. */
export function seasonConfigOf(r: { id: string; name: string; startsAt: string; endsAt: string; rules: object }): SeasonConfig {
  return parseConfig('season', { ...r.rules, id: r.id, name: r.name, startsAt: r.startsAt, endsAt: r.endsAt });
}

/** Parses a record (throws when it does not hold) and completes its rules. */
export function normalizeSeasonRecord(input: unknown): SeasonRecordData {
  const r = seasonRecordSchema.parse(input);
  const { id: _id, name: _name, startsAt: _s, endsAt: _e, ...rules } = seasonConfigOf(r);
  return { id: r.id, name: r.name, startsAt: r.startsAt, endsAt: r.endsAt, rules, route: r.route as ConfigValue<'seasonRoute'>, missions: r.missions, lab: r.lab };
}

/** What a season's gifts are checked against (the mail's checks): the live pieces, probes and events. */
export interface SeasonGiftContext {
  cosmetics: CosmeticsConfig;
  probes: readonly string[];
  events: readonly { id: string; endsAt: string }[];
}

/**
 * Everything that keeps a record from being saved or scheduled, as `{ path, message }` like `configIssues`. With the
 * live permanent lab tree, its seasonal tree must fit the same budget the key `lab` checks over both trees; with the
 * content's anomalies, its anomaly must be one of them; with what is live for gifts, each gift is checked like the
 * mail's (`gift_<code>`): those paid while it is open as of its start, the closing prizes as of its end.
 */
export function seasonRecordIssues(input: unknown, ctx: { labNodes?: ConfigValue<'lab'>['nodes']; anomalies?: readonly string[]; gifts?: SeasonGiftContext } = {}): { path: string; message: string }[] {
  const parsed = seasonRecordSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
  const out: { path: string; message: string }[] = [];
  const r = parsed.data;
  // A step or an item that gives nothing (neither its old reward nor a gift) is a slip.
  r.route.steps.forEach((x, i) => {
    if (x.gifts.length === 0 && !rewardGivesAnything(x.reward)) out.push({ path: `route.steps.${i}`, message: 'season_reward_empty' });
  });
  r.route.shop.forEach((x, i) => {
    if (x.gifts.length === 0 && !rewardGivesAnything(x.reward)) out.push({ path: `route.shop.${i}`, message: 'season_reward_empty' });
  });
  if (ctx.gifts) {
    const g = ctx.gifts;
    for (const list of seasonGiftLists(r.route)) {
      if (list.gifts.length === 0) continue;
      const live = { ...g, season: { id: r.id, open: list.open }, now: new Date(list.open ? r.startsAt : r.endsAt) };
      // What is seasonal was checked by the schema.
      for (const issue of giftIssues(list.gifts, live)) if (issue.code !== 'season_closed') out.push({ path: `${list.path}.${issue.index}`, message: `gift_${issue.code}` });
    }
  }
  if (ctx.labNodes) {
    const lab = configSchemas.lab.safeParse({ nodes: ctx.labNodes, season: r.lab });
    if (!lab.success) for (const i of lab.error.issues) out.push({ path: 'lab', message: i.message });
  }
  const anomaly = seasonConfigOf(r).anomaly;
  if (ctx.anomalies && anomaly !== null && !ctx.anomalies.includes(anomaly)) out.push({ path: 'rules.anomaly', message: 'season_anomaly_unknown' });
  return out;
}

/** The instant a Madrid day (yyyy-mm-dd) starts: 23:00Z the day before in winter, 22:00Z in summer. */
export function madridMidnightOf(day: string): string {
  const base = Date.parse(`${day}T00:00:00.000Z`);
  for (const hours of [1, 2, 0]) {
    const iso = new Date(base - hours * 3_600_000).toISOString();
    if (isMadridMidnight(iso) && madridDayOf(iso) === day) return iso;
  }
  throw new RangeError(`not_a_day:${day}`);
}

const madridDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
/** The Madrid day (yyyy-mm-dd) an instant falls on. */
export function madridDayOf(iso: string): string {
  return madridDay.format(new Date(iso));
}

type Dated = { state: SeasonState; startsAt: string; endsAt: string };

/** The scheduled season open at `now` (starts_at <= now < ends_at), or null. Drafts never count. */
export function currentSeason<T extends Dated>(list: readonly T[], now: number): T | null {
  return list.find((s) => s.state === 'scheduled' && Date.parse(s.startsAt) <= now && now < Date.parse(s.endsAt)) ?? null;
}

/**
 * The season a moment belongs to: the open one, or between seasons the last that ended (scheduled or closed), so its
 * name and currency still show while nothing is open. Null before the first.
 */
export function shownSeason<T extends Dated>(list: readonly T[], now: number): T | null {
  const open = currentSeason(list, now);
  if (open) return open;
  let last: T | null = null;
  for (const s of list) {
    if (s.state === 'draft' || Date.parse(s.endsAt) > now) continue;
    if (!last || Date.parse(s.endsAt) > Date.parse(last.endsAt)) last = s;
  }
  return last;
}
