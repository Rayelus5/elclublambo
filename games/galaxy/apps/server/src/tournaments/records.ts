import {
  type ConfigValue,
  type SeasonConfig,
  seasonConfigOf,
  type TournamentContext,
  tournamentIssues,
  type TournamentRecord,
  tournamentRecordSchema,
  type TournamentState,
} from '@galaxy/shared';
import { type Kysely, type Selectable, sql } from 'kysely';
import type { AuditActor } from '../audit';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';
import type { TournamentScoring } from './scoring';

// Tournaments as rows (plan «temporadas como fichas», part 5; GDD §13.3): reading a tournament with its record, its
// season (whose rules give the points formula) and what a record is checked against. The writes live in admin.ts
// (prepare, schedule, cancel), entries.ts (sign up, leave, collect) and review.ts (the review and the results).

/** A tournament as the server reads it. */
export interface TournamentRow {
  id: string;
  state: TournamentState;
  version: number;
  record: TournamentRecord;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  scheduledAt: string | null;
  scheduledBy: string | null;
  publishedAt: string | null;
  cancelledAt: string | null;
  /** The simulation version when it started (null before). */
  startedSimVersion: string | null;
}

export const TOURNAMENT_FIELDS = [
  'id',
  'slug',
  'season_id',
  'title',
  'summary',
  'rules',
  'banner_media',
  'details_media',
  'starts_at',
  'ends_at',
  'state',
  'exclusive',
  'metric',
  'filters',
  'entry',
  'prizes',
  'participation',
  'review_hours',
  'max_entrants',
  'version',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'scheduled_at',
  'scheduled_by',
  'published_at',
  'cancelled_at',
  'started_sim_version',
] as const;

type Raw = Selectable<DB['galaxy.tournaments']>;

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

/** A stored row as the code reads it (its record checked again: a stored one that no longer holds throws). */
export function readTournamentRow(r: Raw): TournamentRow {
  const record = tournamentRecordSchema.parse({
    slug: r.slug,
    seasonId: r.season_id,
    title: r.title,
    summary: r.summary,
    rules: r.rules,
    bannerMedia: r.banner_media,
    detailsMedia: r.details_media,
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: new Date(r.ends_at).toISOString(),
    exclusive: r.exclusive,
    metric: r.metric,
    filters: r.filters ?? {},
    entry: r.entry ?? null,
    prizes: r.prizes ?? [],
    participation: r.participation ?? null,
    reviewHours: r.review_hours,
    maxEntrants: r.max_entrants,
  });
  return {
    id: r.id,
    state: r.state,
    version: r.version,
    record,
    createdAt: iso(r.created_at)!,
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at)!,
    updatedBy: r.updated_by,
    scheduledAt: iso(r.scheduled_at),
    scheduledBy: r.scheduled_by,
    publishedAt: iso(r.published_at),
    cancelledAt: iso(r.cancelled_at),
    startedSimVersion: r.started_sim_version,
  };
}

/** The columns a record is stored in. */
export function recordColumns(t: TournamentRecord) {
  return {
    slug: t.slug,
    season_id: t.seasonId,
    title: t.title,
    summary: t.summary,
    rules: t.rules,
    banner_media: t.bannerMedia,
    details_media: t.detailsMedia,
    starts_at: t.startsAt,
    ends_at: t.endsAt,
    exclusive: t.exclusive,
    metric: t.metric,
    filters: JSON.stringify(t.filters),
    entry: t.entry ? JSON.stringify(t.entry) : null,
    prizes: JSON.stringify(t.prizes),
    participation: t.participation ? JSON.stringify(t.participation) : null,
    review_hours: t.reviewHours,
    max_entrants: t.maxEntrants,
  };
}

/** One tournament by id (locked for update inside a transaction when `lock`), or 404. */
export async function tournamentById(db: Kysely<DB>, id: string, opts: { lock?: boolean } = {}): Promise<TournamentRow> {
  let q = db.selectFrom('galaxy.tournaments').select(TOURNAMENT_FIELDS).where('id', '=', id);
  if (opts.lock) q = q.forUpdate();
  const r = await q.executeTakeFirst();
  if (!r) throw new HttpError(404, 'tournament_not_found');
  return readTournamentRow(r);
}

/** One tournament players can see (never a draft) by its slug, or 404. */
export async function tournamentBySlug(db: Kysely<DB>, slug: string): Promise<TournamentRow> {
  const r = await db.selectFrom('galaxy.tournaments').select(TOURNAMENT_FIELDS).where('slug', '=', slug).where('state', '<>', 'draft').executeTakeFirst();
  if (!r) throw new HttpError(404, 'tournament_not_found');
  return readTournamentRow(r);
}

/** Tournaments in these states, by start; one whose stored record no longer holds is skipped and reported. */
export async function tournamentsIn(db: Kysely<DB>, states: readonly TournamentState[], onInvalid?: (id: string, err: unknown) => void): Promise<TournamentRow[]> {
  if (states.length === 0) return [];
  const raw = await db.selectFrom('galaxy.tournaments').select(TOURNAMENT_FIELDS).where('state', 'in', states).orderBy('starts_at').orderBy('id').execute();
  const out: TournamentRow[] = [];
  for (const r of raw) {
    try {
      out.push(readTournamentRow(r));
    } catch (err) {
      onInvalid?.(r.id, err);
    }
  }
  return out;
}

/** What the scoring reads of a tournament. */
export const scoringOf = (t: TournamentRow): TournamentScoring => ({ id: t.id, startsAt: t.record.startsAt, endsAt: t.record.endsAt, metric: t.record.metric, filters: t.record.filters });

/** A tournament's season as a record: its state and dates, and its rules as the live key `season` (the points). */
export interface TournamentSeason {
  id: string;
  state: 'draft' | 'scheduled' | 'closed';
  startsAt: string;
  endsAt: string;
  config: SeasonConfig;
}

/** The season record of that id, or null. */
export async function seasonRecord(db: Kysely<DB>, id: string): Promise<TournamentSeason | null> {
  const r = await db.selectFrom('galaxy.seasons').select(['id', 'name', 'state', 'starts_at', 'ends_at', 'rules']).where('id', '=', id).executeTakeFirst();
  if (!r) return null;
  const startsAt = r.starts_at.toISOString();
  const endsAt = r.ends_at.toISOString();
  let config: SeasonConfig;
  try {
    config = seasonConfigOf({ id: r.id, name: r.name, startsAt, endsAt, rules: (r.rules ?? {}) as object });
  } catch {
    config = seasonConfigOf({ id: r.id, name: r.name, startsAt, endsAt, rules: {} });
  }
  return { id: r.id, state: r.state, startsAt, endsAt, config };
}

/**
 * The season whose rules score a tournament. One whose record is gone (a draft season deleted after the tournament was
 * scheduled) scores with the default rules from the tournament's own start.
 */
export async function scoringSeason(db: Kysely<DB>, t: TournamentRow): Promise<SeasonConfig> {
  const s = await seasonRecord(db, t.record.seasonId);
  return s?.config ?? seasonConfigOf({ id: t.record.seasonId, name: t.record.seasonId, startsAt: t.record.startsAt, endsAt: t.record.endsAt, rules: {} });
}

/** What a record is checked against: its season, the content's sectors and probes, the gifts that can be given. */
export async function tournamentContext(db: Kysely<DB>, config: ConfigReader, record: unknown, now: Date): Promise<TournamentContext> {
  const seasonId = record && typeof record === 'object' && typeof (record as { seasonId?: unknown }).seasonId === 'string' ? (record as { seasonId: string }).seasonId : null;
  const [content, cosmetics, events] = await Promise.all([config.get('content'), config.get('cosmetics'), config.get('events')]);
  const s = seasonId ? await seasonRecord(db, seasonId) : null;
  return {
    season: s ? { id: s.id, state: s.state, startsAt: s.startsAt, endsAt: s.endsAt } : null,
    sectors: content.sectors.map((x) => x.id),
    probes: content.probes.map((p) => p.id),
    gifts: { cosmetics, probes: content.probes.map((p) => p.id), events: (events as ConfigValue<'events'>).list.map((e) => ({ id: e.id, endsAt: e.endsAt })), season: { id: s?.id ?? '', open: false }, now },
  };
}

/**
 * Every problem of a record, with its slug free (`self`: the tournament being saved) and its images uploaded. A record
 * that is fine has none.
 */
export async function recordIssues(db: Kysely<DB>, config: ConfigReader, record: unknown, now: Date, self: string | null): Promise<{ path: string; message: string }[]> {
  const issues = tournamentIssues(record, await tournamentContext(db, config, record, now));
  const parsed = tournamentRecordSchema.safeParse(record);
  if (!parsed.success) return issues;
  const t = parsed.data;
  const clash = await db.selectFrom('galaxy.tournaments').select('id').where('slug', '=', t.slug).executeTakeFirst();
  if (clash && clash.id !== self) issues.push({ path: 'slug', message: 'tournament_slug_taken' });
  for (const [path, id] of [['bannerMedia', t.bannerMedia], ['detailsMedia', t.detailsMedia]] as const) {
    if (id && !(await db.selectFrom('galaxy.media_assets').select('id').where('id', '=', id).executeTakeFirst())) issues.push({ path, message: 'tournament_media_unknown' });
  }
  return issues;
}

/** The system's actor for what the job does (the review's marks, the results). */
export const SYSTEM_ACTOR: AuditActor = { id: null, label: 'torneos' };

/** Lock that serialises an account's sign-ups and departures (a row lock on one tournament cannot see another). */
export const entryLock = (accountId: string) => sql`select pg_advisory_xact_lock(hashtextextended(${`galaxy.tournament_entries:${accountId}`}, 0))`;
