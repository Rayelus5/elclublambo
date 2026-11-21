import { z } from 'zod';
import { type ConfigValue, configSchemas, labNodeSchema, parseConfig } from '../config/registry';
import { missionSchema } from './missions';
import type { SeasonConfig } from './season';
import { seasonRouteSchema } from './season-route';

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

/**
 * Everything that keeps a record from being saved or scheduled, as `{ path, message }` like `configIssues`. With the
 * live permanent lab tree, its seasonal tree must fit the same budget the key `lab` checks over both trees; with the
 * content's anomalies, its anomaly must be one of them.
 */
export function seasonRecordIssues(input: unknown, ctx: { labNodes?: ConfigValue<'lab'>['nodes']; anomalies?: readonly string[] } = {}): { path: string; message: string }[] {
  const parsed = seasonRecordSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
  const out: { path: string; message: string }[] = [];
  const r = parsed.data;
  if (ctx.labNodes) {
    const lab = configSchemas.lab.safeParse({ nodes: ctx.labNodes, season: r.lab });
    if (!lab.success) for (const i of lab.error.issues) out.push({ path: 'lab', message: i.message });
  }
  const anomaly = seasonConfigOf(r).anomaly;
  if (ctx.anomalies && anomaly !== null && !ctx.anomalies.includes(anomaly)) out.push({ path: 'rules.anomaly', message: 'season_anomaly_unknown' });
  return out;
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
