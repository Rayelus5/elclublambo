import {
  type ConfigKey,
  type ConfigValue,
  configSchemas,
  labNodeSchema,
  type MailLimits,
  normalizeSeasonRecord,
  parseConfig,
  seasonBigGifts,
  type SeasonGiftContext,
  type SeasonRecordData,
  seasonConfigOf,
  seasonRecordIssues,
  type SeasonState,
  shownSeason,
  tournamentFitsSeason,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import { type AuditActor, writeAudit } from '../audit';
import type { ConfigService } from '../config/service';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { closeDue } from './close';
import type { SeasonConfigs } from './service';

// Seasons as records (plan «temporadas como fichas», 2026-11-21; GDD §13.1). A season is a row of galaxy.seasons with
// its dates, rules, route and shop, missions and seasonal lab tree. The rest of the server keeps reading the live keys
// `season`, `seasonRoute`, `missions` and `lab` as before: the reader is wrapped so those come from the season a moment
// belongs to (the open one; between two seasons, the last that ended). The cache keeps the list of seasons, never «the
// current one», so the switch at 00:00 is exact. Those keys can no longer be published the old way.

/** A season as the server reads it. */
export interface SeasonRow extends SeasonRecordData {
  state: SeasonState;
  version: number;
  announcedAt: string | null;
}

export interface SeasonStore {
  /** Every season that is not a draft, by start (cached; a change in this process invalidates at once). */
  list(): Promise<SeasonRow[]>;
  invalidate(): void;
}

const missionsOf = (raw: unknown) => parseConfig('missions', { season: raw }).season;
const labTree = z.array(labNodeSchema).max(120);

/** A stored row as the code reads it (lenient: an imported season need not start at midnight). */
export function readSeasonRow(r: { id: string; name: string; starts_at: Date; ends_at: Date; state: SeasonState; rules: unknown; route: unknown; missions: unknown; lab: unknown; version: number; announced_at: Date | null }): SeasonRow {
  const startsAt = r.starts_at.toISOString();
  const endsAt = r.ends_at.toISOString();
  const { id: _i, name: _n, startsAt: _s, endsAt: _e, ...rules } = seasonConfigOf({ id: r.id, name: r.name, startsAt, endsAt, rules: (r.rules ?? {}) as object });
  return {
    id: r.id,
    name: r.name,
    startsAt,
    endsAt,
    state: r.state,
    rules,
    route: parseConfig('seasonRoute', r.route ?? {}),
    missions: missionsOf(r.missions ?? []),
    lab: labTree.parse(r.lab ?? []),
    version: r.version,
    announcedAt: r.announced_at?.toISOString() ?? null,
  };
}

const ROW_FIELDS = ['id', 'name', 'starts_at', 'ends_at', 'state', 'rules', 'route', 'missions', 'lab', 'version', 'announced_at'] as const;

/** The seasons that count (not drafts), cached for `ttlMs` (10 s, like the live config). */
export function createSeasonStore(db: Kysely<DB>, opts: { ttlMs?: number; now?: () => number; onInvalid?: (id: string, err: unknown) => void } = {}): SeasonStore {
  const ttlMs = opts.ttlMs ?? 10_000;
  const now = opts.now ?? Date.now;
  let cache: { rows: SeasonRow[]; at: number } | null = null;
  return {
    async list() {
      if (cache && now() - cache.at < ttlMs) return cache.rows;
      const raw = await db.selectFrom('galaxy.seasons').select(ROW_FIELDS).where('state', '<>', 'draft').orderBy('starts_at').execute();
      const rows: SeasonRow[] = [];
      for (const r of raw) {
        try {
          rows.push(readSeasonRow(r));
        } catch (err) {
          opts.onInvalid?.(r.id, err);
        }
      }
      cache = { rows, at: now() };
      return rows;
    },
    invalidate() {
      cache = null;
    },
  };
}

/** The value a season key takes from `row` (the rest of the key, like the daily missions, stays as it is). */
function overlay<K extends ConfigKey>(key: K, value: ConfigValue<K>, row: SeasonRow): ConfigValue<K> {
  if (key === 'season') return seasonConfigOf(row) as ConfigValue<K>;
  if (key === 'seasonRoute') return row.route as ConfigValue<K>;
  if (key === 'missions') return { ...(value as ConfigValue<'missions'>), season: row.missions } as ConfigValue<K>;
  if (key === 'lab') return { ...(value as ConfigValue<'lab'>), season: row.lab } as ConfigValue<K>;
  return value;
}
const SEASON_KEYS = new Set<string>(['season', 'seasonRoute', 'missions', 'lab']);

/**
 * Publishing the old way is over: the season and its route, and the season's own missions and lab tree. A copy of what
 * is live (a rollback saved with show-config --data, a version loaded in the panel) carries the season's missions or
 * tree exactly as the record has them: that field is dropped and the rest publishes.
 */
function withoutSeasonFields(key: ConfigKey, data: unknown, row: SeasonRow | null): unknown {
  if (key === 'season' || key === 'seasonRoute') throw new HttpError(409, 'season_managed');
  if ((key !== 'missions' && key !== 'lab') || !data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, 'season')) return data;
  const { season, ...rest } = data as Record<string, unknown>;
  const current = key === 'missions' ? (row?.missions ?? []) : (row?.lab ?? []);
  const normalized = key === 'missions' ? (() => { try { return missionsOf(season); } catch { return null; } })() : labTree.safeParse(season).data ?? null;
  if (JSON.stringify(normalized) !== JSON.stringify(current)) throw new HttpError(409, 'season_managed');
  return rest;
}

/**
 * The live config reader with seasons as records: `season`, `seasonRoute`, `missions.season` and `lab.season` come from
 * the season `now` belongs to; with no season at all (before the first import), from the old keys. Publishing refuses
 * those, and a new permanent lab tree must fit with every season still to run.
 */
export function seasonAwareConfig(base: ConfigService, store: SeasonStore, now: () => Date): ConfigService {
  const shown = async () => shownSeason(await store.list(), now().getTime());
  async function checkLab(key: ConfigKey, data: unknown): Promise<void> {
    if (key !== 'lab' || !data || typeof data !== 'object' || !('nodes' in data)) return;
    const t = now().getTime();
    const issues: { path: string; message: string }[] = [];
    for (const s of await store.list()) {
      if (s.state !== 'scheduled' || Date.parse(s.endsAt) <= t) continue;
      const r = configSchemas.lab.safeParse({ nodes: (data as { nodes: unknown }).nodes, season: s.lab });
      if (!r.success) for (const i of r.error.issues) issues.push({ path: 'nodes', message: `${i.message} (temporada ${s.id})` });
    }
    if (issues.length > 0) throw new HttpError(400, 'config_invalid', { issues });
  }
  return {
    ...base,
    async get(key) {
      const value = await base.get(key);
      if (!SEASON_KEYS.has(key)) return value;
      const row = await shown();
      return row ? overlay(key, value, row) : value;
    },
    async getVersioned(key) {
      const r = await base.getVersioned(key);
      if (!SEASON_KEYS.has(key)) return r;
      const row = await shown();
      return row ? { ...r, value: overlay(key, r.value, row) } : r;
    },
    async active() {
      const rows = await base.active();
      const row = await shown();
      if (!row) return rows;
      return rows.map((r) => {
        if (!SEASON_KEYS.has(r.key)) return r;
        // A stored row that no longer parses is shown as it is (the readers fall back to defaults on their own).
        try {
          return { ...r, data: overlay(r.key as ConfigKey, parseConfig(r.key as ConfigKey, r.data ?? {}), row) };
        } catch {
          return r;
        }
      });
    },
    async publish(key, data, actor, reason, opts) {
      const rest = withoutSeasonFields(key, data, await shown());
      await checkLab(key, rest);
      return base.publish(key, rest as never, actor, reason, opts);
    },
    async publishMany(items, actor, reason) {
      const row = await shown();
      const cleaned = [];
      for (const it of items) {
        const rest = withoutSeasonFields(it.key, it.data, row);
        await checkLab(it.key, rest);
        cleaned.push({ ...it, data: rest });
      }
      return base.publishMany(cleaned, actor, reason);
    },
  };
}

/** What the season code needs from a record: its key `season`, its route and the minimum a run lasts to count. */
export function seasonConfigsOf(row: SeasonRow, minRunSeconds: number): SeasonConfigs {
  return { season: seasonConfigOf(row), route: row.route, minRunSeconds };
}

/**
 * Archives every scheduled season whose end has passed (its own closing prizes) and marks it closed. Safe from any read:
 * closeDue is idempotent; this is what closes a season that ended while the next one is already open.
 */
export async function closeEndedSeasons(db: Kysely<DB>, store: SeasonStore, minRunSeconds: number, now: Date): Promise<void> {
  let changed = false;
  for (const row of await store.list()) {
    if (row.state !== 'scheduled' || Date.parse(row.endsAt) > now.getTime()) continue;
    // The list may be up to 10 s old: the row is read again (an end moved meanwhile keeps it open).
    const fresh = await db.selectFrom('galaxy.seasons').select(ROW_FIELDS).where('id', '=', row.id).where('state', '=', 'scheduled').where('ends_at', '<=', now).executeTakeFirst();
    if (!fresh) {
      changed = true;
      continue;
    }
    const current = readSeasonRow(fresh);
    await closeDue(db, seasonConfigsOf(current, minRunSeconds), now);
    const done = await inTransaction(db, async (trx) => {
      const up = await trx
        .updateTable('galaxy.seasons')
        .set({ state: 'closed', version: current.version + 1, updated_at: now })
        .where('id', '=', current.id)
        .where('state', '=', 'scheduled')
        .where('ends_at', '<=', now)
        .returning('id')
        .executeTakeFirst();
      if (up) await revise(trx, { ...current, state: 'closed' }, current.version + 1, CLOSE_ACTOR, 'Cerrada al acabar');
      return !!up;
    });
    if (done) changed = true;
  }
  if (changed) store.invalidate();
}

// ---------------------------------------------------------------------------------------------------------------------
// Changing seasons (the CLI now, the panel's «Temporadas» next): one writer at a time, every change a revision.

const LOCK = sql`select pg_advisory_xact_lock(hashtext('galaxy.seasons'))`;
const CLOSE_ACTOR: AuditActor = { id: null, label: 'cierre' };
/**
 * The overlap check is deferred to the commit (so one transaction can extend a season and push the next); each change
 * runs it at its own end, inside the function, so a clash comes back as `season_overlap` wherever the transaction ends.
 */
const CHECK_NOW = {
  async execute(trx: Kysely<DB>): Promise<void> {
    await sql`set constraints galaxy.seasons_no_overlap immediate`.execute(trx);
    // Back to deferred for whatever else the same transaction does (a caller's own transaction, the tests').
    await sql`set constraints galaxy.seasons_no_overlap deferred`.execute(trx);
  },
};

/**
 * What a record checks against: the live permanent lab tree and the content's anomalies; and, for its gifts (PR 4),
 * the live pieces, probes and events, and the limits that make a gift big (absent: not checked).
 */
export interface SeasonContext {
  labNodes: ConfigValue<'lab'>['nodes'];
  anomalies: readonly string[];
  gifts?: SeasonGiftContext;
  limits?: MailLimits;
}

export async function seasonContext(config: ConfigService): Promise<SeasonContext> {
  const [lab, content, cosmetics, events, limits] = await Promise.all([config.get('lab'), config.get('content'), config.get('cosmetics'), config.get('events'), config.get('mailLimits')]);
  return {
    labNodes: lab.nodes,
    anomalies: content.anomalies.map((a) => a.id),
    gifts: { cosmetics, probes: content.probes.map((p) => p.id), events: events.list.map((e) => ({ id: e.id, endsAt: e.endsAt })) },
    limits,
  };
}

/** Who schedules or changes a season: from the panel, whether they are a superadmin (the CLI is the owner's). */
export interface SeasonRights {
  superadmin?: boolean;
}

/**
 * A season whose gifts are big (past the mail's limits, `seasonBigGifts`) only a superadmin schedules or changes, like
 * a big message (403 season_needs_superadmin, with why).
 */
function requireRights(route: ConfigValue<'seasonRoute'>, ctx: SeasonContext, rights: SeasonRights): void {
  if (rights.superadmin !== false || !ctx.limits || !ctx.gifts) return;
  const big = seasonBigGifts(route, ctx.limits, ctx.gifts.cosmetics);
  if (big.length > 0) throw new HttpError(403, 'season_needs_superadmin', { reasons: [...new Set(big.flatMap((b) => b.reasons))], big });
}

/** Postgres's exclusion and check violations, as the API's codes (the overlap is checked at commit: it is deferred). */
function seasonDbError(err: unknown): never {
  const code = (err as { code?: string }).code;
  if (code === '23P01') throw new HttpError(409, 'season_overlap');
  if (code === '23514') throw new HttpError(400, 'season_invalid', { issues: [{ path: 'endsAt', message: 'season_dates' }] });
  throw err;
}

function snapshot(r: SeasonRecordData & { state: SeasonState }) {
  return { id: r.id, name: r.name, startsAt: r.startsAt, endsAt: r.endsAt, state: r.state, rules: r.rules, route: r.route, missions: r.missions, lab: r.lab };
}

async function revise(trx: Kysely<DB>, r: SeasonRecordData & { state: SeasonState }, version: number, actor: AuditActor, note: string): Promise<void> {
  await trx.insertInto('galaxy.season_revisions').values({ season: r.id, version, data: JSON.stringify(snapshot(r)), created_by: actor.id, note }).execute();
}

async function rowFor(trx: Kysely<DB>, id: string): Promise<SeasonRow> {
  const r = await trx.selectFrom('galaxy.seasons').select(ROW_FIELDS).where('id', '=', id).forUpdate().executeTakeFirst();
  if (!r) throw new HttpError(404, 'season_not_found');
  return readSeasonRow(r);
}

/**
 * Saves a season as a draft: a new one, or a draft that already exists replaced whole. A scheduled or closed season is
 * never edited here (unschedule it first). Checked like a schedule would check it, so a draft that saves also holds.
 */
export async function saveSeasonDraft(db: Kysely<DB>, input: unknown, ctx: SeasonContext, actor: AuditActor, reason: string): Promise<SeasonRow> {
  const issues = seasonRecordIssues(input, ctx);
  if (issues.length > 0) throw new HttpError(400, 'season_invalid', { issues });
  const r = normalizeSeasonRecord(input);
  return inTransaction(db, async (trx) => {
    await LOCK.execute(trx);
    const old = await trx.selectFrom('galaxy.seasons').select(['state', 'version']).where('id', '=', r.id).forUpdate().executeTakeFirst();
    if (old && old.state !== 'draft') throw new HttpError(409, 'season_not_draft');
    const values = {
      name: r.name,
      starts_at: r.startsAt,
      ends_at: r.endsAt,
      rules: JSON.stringify(r.rules),
      route: JSON.stringify(r.route),
      missions: JSON.stringify(r.missions),
      lab: JSON.stringify(r.lab),
      updated_by: actor.id,
    };
    const version = (old?.version ?? 0) + 1;
    if (old) await trx.updateTable('galaxy.seasons').set({ ...values, version, updated_at: sql`now()` }).where('id', '=', r.id).execute();
    else await trx.insertInto('galaxy.seasons').values({ id: r.id, ...values, state: 'draft', created_by: actor.id }).execute();
    await revise(trx, { ...r, state: 'draft' }, version, actor, reason);
    await writeAudit(trx, { actor, action: 'season.saved', targetType: 'season', targetId: r.id, after: snapshot({ ...r, state: 'draft' }), reason });
    return rowFor(trx, r.id);
  }).catch(seasonDbError);
}

/**
 * A draft becomes scheduled: it counts from its start on its own. Re-checked against what is live now, and, with big
 * gifts, only by a superadmin (checked on the row locked, so a draft saved meanwhile cannot slip through).
 */
export async function scheduleSeason(db: Kysely<DB>, id: string, ctx: SeasonContext, actor: AuditActor, reason: string, rights: SeasonRights = {}): Promise<SeasonRow> {
  return inTransaction(db, async (trx) => {
    await LOCK.execute(trx);
    const r = await rowFor(trx, id);
    if (r.state !== 'draft') throw new HttpError(409, 'season_not_draft');
    const issues = seasonRecordIssues({ id: r.id, name: r.name, startsAt: r.startsAt, endsAt: r.endsAt, rules: r.rules, route: r.route, missions: r.missions, lab: r.lab }, ctx);
    if (Date.parse(r.endsAt) <= Date.now()) issues.push({ path: 'endsAt', message: 'season_end_past' });
    if (await trx.selectFrom('galaxy.season_archive').select('season').where('season', '=', r.id).executeTakeFirst()) issues.push({ path: 'id', message: 'season_id_used' });
    if (issues.length > 0) throw new HttpError(400, 'season_invalid', { issues });
    requireRights(r.route, ctx, rights);
    const version = r.version + 1;
    await trx.updateTable('galaxy.seasons').set({ state: 'scheduled', version, scheduled_at: sql`now()`, scheduled_by: actor.id, updated_at: sql`now()`, updated_by: actor.id }).where('id', '=', id).execute();
    await CHECK_NOW.execute(trx);
    await revise(trx, { ...r, state: 'scheduled' }, version, actor, reason);
    await writeAudit(trx, { actor, action: 'season.scheduled', targetType: 'season', targetId: id, after: { startsAt: r.startsAt, endsAt: r.endsAt }, reason });
    return rowFor(trx, id);
  }).catch(seasonDbError);
}

/**
 * Fixes a scheduled season in place (a wrong price, reward or mission found once it is running): the whole record,
 * checked like a schedule. Its id never changes, nor its start once it has started (its end moves with extendSeason).
 * A version, a revision and an audit entry, like every change.
 */
export async function patchScheduledSeason(db: Kysely<DB>, id: string, input: unknown, ctx: SeasonContext, actor: AuditActor, reason: string, now: Date, rights: SeasonRights = {}): Promise<SeasonRow> {
  const issues = seasonRecordIssues(input, ctx);
  if (issues.length > 0) throw new HttpError(400, 'season_invalid', { issues });
  const r = normalizeSeasonRecord(input);
  if (r.id !== id) throw new HttpError(400, 'season_invalid', { issues: [{ path: 'id', message: 'season_id_fixed' }] });
  requireRights(r.route, ctx, rights);
  return inTransaction(db, async (trx) => {
    await LOCK.execute(trx);
    const old = await rowFor(trx, id);
    if (old.state !== 'scheduled') throw new HttpError(409, 'season_not_draft');
    const started = Date.parse(old.startsAt) <= now.getTime();
    if (started && r.startsAt !== old.startsAt) throw new HttpError(409, 'season_started');
    if (Date.parse(r.endsAt) <= now.getTime()) throw new HttpError(400, 'season_invalid', { issues: [{ path: 'endsAt', message: 'season_end_past' }] });
    const version = old.version + 1;
    await trx
      .updateTable('galaxy.seasons')
      .set({ name: r.name, starts_at: r.startsAt, ends_at: r.endsAt, rules: JSON.stringify(r.rules), route: JSON.stringify(r.route), missions: JSON.stringify(r.missions), lab: JSON.stringify(r.lab), version, updated_at: sql`now()`, updated_by: actor.id })
      .where('id', '=', id)
      .execute();
    await CHECK_NOW.execute(trx);
    await revise(trx, { ...r, state: 'scheduled' }, version, actor, reason);
    await writeAudit(trx, { actor, action: 'season.patched', targetType: 'season', targetId: id, before: snapshot(old), after: snapshot({ ...r, state: 'scheduled' }), reason });
    return rowFor(trx, id);
  }).catch(seasonDbError);
}

/** A scheduled season that has not started goes back to draft (to change it, or not run it). */
export async function unscheduleSeason(db: Kysely<DB>, id: string, actor: AuditActor, reason: string, now: Date): Promise<SeasonRow> {
  return inTransaction(db, async (trx) => {
    await LOCK.execute(trx);
    const r = await rowFor(trx, id);
    if (r.state !== 'scheduled') throw new HttpError(409, 'season_not_draft');
    if (Date.parse(r.startsAt) <= now.getTime()) throw new HttpError(409, 'season_started');
    const version = r.version + 1;
    await trx.updateTable('galaxy.seasons').set({ state: 'draft', version, scheduled_at: null, scheduled_by: null, updated_at: sql`now()`, updated_by: actor.id }).where('id', '=', id).execute();
    await revise(trx, { ...r, state: 'draft' }, version, actor, reason);
    await writeAudit(trx, { actor, action: 'season.unscheduled', targetType: 'season', targetId: id, reason });
    return rowFor(trx, id);
  });
}

type Issue = { path: string; message: string };
const issueKey = (i: Issue) => `${i.path}\u0000${i.message}`;

/** The issues of `after` that `before` did not have (same path and message): what a change breaks. */
export function introducedIssues(before: readonly Issue[], after: readonly Issue[]): Issue[] {
  const had = new Set(before.map(issueKey));
  return after.filter((i) => !had.has(issueKey(i)));
}

/** A row as the record it was saved from (what seasonRecordIssues checks). */
const recordOf = (r: SeasonRecordData) => ({ id: r.id, name: r.name, startsAt: r.startsAt, endsAt: r.endsAt, rules: r.rules, route: r.route, missions: r.missions, lab: r.lab });

/** The tournaments that count (sign-up open, running or in review) and would no longer fit their season's new dates. */
async function cutTournaments(trx: Kysely<DB>, seasons: readonly { id: string; startsAt: string; endsAt: string }[]): Promise<number> {
  const rows = await trx
    .selectFrom('galaxy.tournaments')
    .select(['season_id', 'starts_at', 'ends_at'])
    .where('season_id', 'in', seasons.map((s) => s.id))
    .where('state', 'in', ['scheduled', 'running', 'review'])
    .execute();
  return rows.filter((t) => {
    const s = seasons.find((x) => x.id === t.season_id)!;
    return !tournamentFitsSeason({ startsAt: new Date(t.starts_at).toISOString(), endsAt: new Date(t.ends_at).toISOString() }, s);
  }).length;
}

/**
 * Moves a scheduled season's end (never before now, always at a Madrid midnight). With `moveNext`, the scheduled season
 * that started where this one ended starts at the new end too (both in one transaction: the overlap check waits for the
 * commit). Refused when the new dates break what held (checked against `ctx`, what is live): a gift checked at the end
 * (an event's signals that would not last until it), or a tournament of either season left outside its dates
 * (`season_cuts_tournament`). What already failed before the move does not hold it back.
 */
export async function extendSeason(db: Kysely<DB>, id: string, endsAt: string, opts: { moveNext: boolean }, ctx: SeasonContext, actor: AuditActor, reason: string, now: Date): Promise<SeasonRow> {
  return inTransaction(db, async (trx) => {
    await LOCK.execute(trx);
    const r = await rowFor(trx, id);
    if (r.state !== 'scheduled') throw new HttpError(409, 'season_not_draft');
    if (Date.parse(r.endsAt) <= now.getTime()) throw new HttpError(400, 'season_invalid', { issues: [{ path: 'endsAt', message: 'season_ended' }] });
    const moved = { ...recordOf(r), endsAt };
    const check = seasonRecordIssues(moved).filter((i) => i.path === 'endsAt' || i.message === 'season_dates');
    if (Date.parse(endsAt) <= now.getTime()) check.push({ path: 'endsAt', message: 'season_end_past' });
    const add = (issues: Issue[]) => {
      for (const i of issues) if (!check.some((c) => issueKey(c) === issueKey(i))) check.push(i);
    };
    add(introducedIssues(seasonRecordIssues(recordOf(r), ctx), seasonRecordIssues(moved, ctx)));
    const dates = [{ id: r.id, startsAt: r.startsAt, endsAt }];
    let n: SeasonRow | null = null;
    if (opts.moveNext) {
      const next = await trx.selectFrom('galaxy.seasons').select('id').where('state', '=', 'scheduled').where('starts_at', '=', new Date(r.endsAt)).forUpdate().executeTakeFirst();
      if (next) {
        n = await rowFor(trx, next.id);
        if (Date.parse(endsAt) >= Date.parse(n.endsAt)) throw new HttpError(400, 'season_invalid', { issues: [{ path: 'endsAt', message: 'season_swallows_next' }] });
        // The next season's own record, before and after its new start (its issues under `next.`).
        add(introducedIssues(seasonRecordIssues(recordOf(n), ctx), seasonRecordIssues({ ...recordOf(n), startsAt: endsAt }, ctx)).map((i) => ({ path: `next.${i.path}`, message: i.message })));
        dates.push({ id: n.id, startsAt: endsAt, endsAt: n.endsAt });
      }
    }
    if ((await cutTournaments(trx, dates)) > 0) check.push({ path: 'endsAt', message: 'season_cuts_tournament' });
    if (check.length > 0) throw new HttpError(400, 'season_invalid', { issues: check });
    const version = r.version + 1;
    await trx.updateTable('galaxy.seasons').set({ ends_at: endsAt, version, updated_at: sql`now()`, updated_by: actor.id }).where('id', '=', id).execute();
    await revise(trx, { ...r, endsAt, state: r.state }, version, actor, reason);
    if (n) {
      await trx.updateTable('galaxy.seasons').set({ starts_at: endsAt, version: n.version + 1, updated_at: sql`now()`, updated_by: actor.id }).where('id', '=', n.id).execute();
      await revise(trx, { ...n, startsAt: endsAt }, n.version + 1, actor, reason);
    }
    await CHECK_NOW.execute(trx);
    await writeAudit(trx, { actor, action: 'season.extended', targetType: 'season', targetId: id, before: { endsAt: r.endsAt }, after: { endsAt, moveNext: opts.moveNext }, reason });
    return rowFor(trx, id);
  }).catch(seasonDbError);
}

/** Removes a draft and its revisions (a scheduled or closed season stays as history). */
export async function deleteSeasonDraft(db: Kysely<DB>, id: string, actor: AuditActor, reason: string): Promise<void> {
  await inTransaction(db, async (trx) => {
    await LOCK.execute(trx);
    const r = await rowFor(trx, id);
    if (r.state !== 'draft') throw new HttpError(409, 'season_not_draft');
    await trx.deleteFrom('galaxy.seasons').where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'season.deleted', targetType: 'season', targetId: id, before: snapshot(r), reason });
  });
}

/** One season by id, drafts too (an admin's preview), or null. */
export async function seasonById(db: Kysely<DB>, id: string): Promise<SeasonRow | null> {
  const r = await db.selectFrom('galaxy.seasons').select(ROW_FIELDS).where('id', '=', id).executeTakeFirst();
  return r ? readSeasonRow(r) : null;
}

/** Every season with its state, drafts too, by start (the CLI's list and the panel's timeline). */
export async function allSeasons(db: Kysely<DB>): Promise<SeasonRow[]> {
  const raw = await db.selectFrom('galaxy.seasons').select(ROW_FIELDS).orderBy('starts_at').execute();
  return raw.map(readSeasonRow);
}

// ---------------------------------------------------------------------------------------------------------------------
// The first deploy: what was live becomes records.

const IMPORT_ACTOR: AuditActor = { id: null, label: 'import' };

/**
 * Once, when galaxy.seasons is still empty and a season was ever published: the live season (with its live route,
 * season missions and lab tree) becomes a record, and every archived season a closed one (dates cut at its close, and
 * skipped when it would overlap one already kept). Under a lock, so two processes never both import.
 */
export async function importSeasons(db: Kysely<DB>, base: ConfigService): Promise<'present' | 'nothing' | 'imported'> {
  const [season, route, missions, lab] = await Promise.all([base.get('season'), base.get('seasonRoute'), base.get('missions'), base.get('lab')]);
  return inTransaction(db, async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext('galaxy.seasons:import'))`.execute(trx);
    await LOCK.execute(trx);
    // Done once the live season is a record (other records, a draft made first, do not count).
    if (await trx.selectFrom('galaxy.seasons').select('id').where('id', '=', season.id).executeTakeFirst()) return 'present' as const;
    if (!(await trx.selectFrom('galaxy.game_config_versions').select('version').where('key', '=', 'season').limit(1).executeTakeFirst())) return 'nothing' as const;
    const existing = await trx.selectFrom('galaxy.seasons').select(['id', 'state', 'starts_at', 'ends_at']).execute();
    const archive = await trx.selectFrom('galaxy.season_archive').select(['season', 'name', 'starts_at', 'ends_at', 'closed_at']).orderBy('starts_at').execute();
    const versions = await trx.selectFrom('galaxy.game_config_versions').select(['data', 'created_at']).where('key', '=', 'season').orderBy('version').execute();
    const { id: _i, name: _n, startsAt: _s, endsAt: _e, ...liveRules } = season;
    type Planned = { id: string; name: string; startsAt: string; endsAt: string; state: SeasonState; rules: object; route: unknown; missions: unknown; lab: unknown };
    const planned: Planned[] = [];
    for (const a of archive) {
      if (a.season === season.id) continue;
      // Its rules as last published under its id (defaults when they no longer parse); its route is not known any more.
      const last = [...versions].reverse().find((v) => (v.data as { id?: string } | null)?.id === a.season);
      let rules: object = {};
      try {
        const { id: _a, name: _b, startsAt: _c, endsAt: _d, ...r } = parseConfig('season', last?.data ?? {});
        rules = r;
      } catch {
        rules = {};
      }
      const end = Math.min(a.ends_at.getTime(), a.closed_at.getTime());
      if (end <= a.starts_at.getTime()) continue;
      planned.push({ id: a.season, name: a.name, startsAt: a.starts_at.toISOString(), endsAt: new Date(end).toISOString(), state: 'closed', rules, route: {}, missions: [], lab: [] });
    }
    // The live season keeps its dates and stays scheduled, even if it was archived before (its close then does nothing
    // more): it is what players are playing now.
    if (Date.parse(season.endsAt) > Date.parse(season.startsAt)) {
      planned.push({ id: season.id, name: season.name, startsAt: season.startsAt, endsAt: season.endsAt, state: 'scheduled', rules: liveRules, route, missions: missions.season, lab: lab.season });
    }
    // The live season first: an archived one that overlaps it is the one left out.
    const kept: Planned[] = [];
    const overlaps = (x: { startsAt: string; endsAt: string }, y: { startsAt: string; endsAt: string }) => Date.parse(x.startsAt) < Date.parse(y.endsAt) && Date.parse(y.startsAt) < Date.parse(x.endsAt);
    const counted = existing.filter((e) => e.state !== 'draft').map((e) => ({ startsAt: e.starts_at.toISOString(), endsAt: e.ends_at.toISOString() }));
    const taken = new Set(existing.map((e) => e.id));
    for (const p of [...planned].reverse()) if (!taken.has(p.id) && !counted.some((k) => overlaps(k, p)) && !kept.some((k) => overlaps(k, p))) kept.push(p);
    for (const p of kept) {
      await trx
        .insertInto('galaxy.seasons')
        .values({
          id: p.id,
          name: p.name,
          starts_at: p.startsAt,
          ends_at: p.endsAt,
          state: p.state,
          rules: JSON.stringify(p.rules),
          route: JSON.stringify(parseConfig('seasonRoute', p.route ?? {})),
          missions: JSON.stringify(p.missions),
          lab: JSON.stringify(p.lab),
          scheduled_at: p.state === 'scheduled' ? new Date() : null,
          // Already running or over: never announced as if it had just started.
          announced_at: new Date(),
        })
        .execute();
      const row = readSeasonRow({ id: p.id, name: p.name, starts_at: new Date(p.startsAt), ends_at: new Date(p.endsAt), state: p.state, rules: p.rules, route: p.route, missions: p.missions, lab: p.lab, version: 1, announced_at: null });
      await revise(trx, row, 1, IMPORT_ACTOR, 'Importada de la configuración publicada');
    }
    await CHECK_NOW.execute(trx);
    await writeAudit(trx, { actor: IMPORT_ACTOR, action: 'season.imported', targetType: 'season', after: kept.map((k) => ({ id: k.id, state: k.state, startsAt: k.startsAt, endsAt: k.endsAt })), reason: 'Temporadas como fichas' });
    return 'imported' as const;
  });
}

/**
 * The production entry's import: tried now and, until it works, every minute (a failure is logged, never fatal).
 * Returns the stop function.
 */
export function startSeasonImport(db: Kysely<DB>, base: ConfigService, store: SeasonStore, log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }): () => void {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const attempt = async () => {
    try {
      const result = await importSeasons(db, base);
      store.invalidate();
      log.info({ result }, 'seasons_import');
      return true;
    } catch (err) {
      log.error({ err: { name: (err as Error).name, code: (err as { code?: unknown }).code } }, 'seasons_import_failed');
      return false;
    }
  };
  void attempt().then((ok) => {
    if (ok || stopped) return;
    timer = setInterval(() => {
      void attempt().then((done) => {
        if (done && timer) {
          clearInterval(timer);
          timer = null;
        }
      });
    }, 60_000);
    timer.unref();
  });
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}
