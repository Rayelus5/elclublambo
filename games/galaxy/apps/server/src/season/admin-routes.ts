import {
  type AdminSeason,
  type AdminSeasonList,
  currentSeason,
  seasonActionBodySchema,
  seasonBigGifts,
  seasonCalendarWarnings,
  seasonDeleteBodySchema,
  seasonExtendBodySchema,
  seasonIdParamsSchema,
  type SeasonIssue,
  seasonRecordIssues,
  seasonRecordSchema,
  seasonSaveBodySchema,
  seasonValidateBodySchema,
} from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { confirmPassword } from '../admin/players';
import { requireAdmin } from '../auth/guards';
import type { ConfigService } from '../config/service';
import type { DB } from '../db/schema';
import type { Env } from '../env';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { allSeasons, deleteSeasonDraft, extendSeason, saveSeasonDraft, scheduleSeason, seasonContext, type SeasonRow, type SeasonStore, unscheduleSeason } from './records';

// The panel's «Temporadas» (plan «temporadas como fichas», 2026-11-21): every season as a record with its calendar
// warnings; drafts saved with a reason, and scheduling, unscheduling and moving an end with the admin's password too.
// The lazy close and the minute job do the rest: a scheduled season opens and closes on its own.

const toAdmin = (s: SeasonRow, now: number): AdminSeason => ({
  id: s.id,
  name: s.name,
  startsAt: s.startsAt,
  endsAt: s.endsAt,
  state: s.state,
  open: currentSeason([s], now) !== null,
  version: s.version,
  rules: s.rules,
  route: s.route,
  missions: s.missions,
  lab: s.lab,
});

/** A record's own problems, plus overlapping a scheduled or closed season (it could never be scheduled). */
export async function seasonIssues(db: Kysely<DB>, config: ConfigService, record: unknown): Promise<SeasonIssue[]> {
  const issues = seasonRecordIssues(record, await seasonContext(config));
  const parsed = seasonRecordSchema.safeParse(record);
  if (parsed.success) {
    const r = parsed.data;
    for (const s of await allSeasons(db)) {
      if (s.id === r.id || s.state === 'draft') continue;
      if (Date.parse(r.startsAt) < Date.parse(s.endsAt) && Date.parse(s.startsAt) < Date.parse(r.endsAt)) issues.push({ path: 'startsAt', message: `season_overlap:${s.id}` });
    }
  }
  return issues;
}

export function registerSeasonAdminRoutes(api: FastifyInstance, deps: { db: Kysely<DB>; config: ConfigService; env: Env; now: () => Date; seasons: SeasonStore | null }): void {
  const actorOf = (req: Parameters<typeof requireAdmin>[0], admin: ReturnType<typeof requireAdmin>) => ({ id: admin.accountId, label: admin.username, ip: clientIp(req, deps.env.TRUST_CF_IP) });
  const changed = () => deps.seasons?.invalidate();

  api.get('/galaxy/api/admin/seasons', async (req): Promise<AdminSeasonList> => {
    const admin = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${admin.accountId}`, 'admin', 120, 60);
    const now = deps.now().getTime();
    const list = await allSeasons(deps.db);
    return { seasons: list.map((s) => toAdmin(s, now)), now: new Date(now).toISOString(), warnings: seasonCalendarWarnings(list, now) };
  });

  // The record's problems and, since PR 4, which of its prizes are big (only a superadmin schedules it then).
  api.post('/galaxy/api/admin/seasons/validate', { bodyLimit: 1024 * 1024 }, async (req) => {
    const admin = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${admin.accountId}`, 'admin', 120, 60);
    const { record } = seasonValidateBodySchema.parse(req.body);
    const issues = await seasonIssues(deps.db, deps.config, record);
    const parsed = seasonRecordSchema.safeParse(record);
    const ctx = await seasonContext(deps.config);
    const big = parsed.success && ctx.limits && ctx.gifts ? seasonBigGifts(parsed.data.route, ctx.limits, ctx.gifts.cosmetics) : [];
    return { ok: issues.length === 0, issues, big };
  });

  // Saving a draft: new, or replacing a draft whole. A draft is invisible to players, so a reason is enough.
  api.post('/galaxy/api/admin/seasons', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const admin = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${admin.accountId}`, 'admin', 60, 60);
    const { record, reason } = seasonSaveBodySchema.parse(req.body);
    const saved = await saveSeasonDraft(deps.db, record, await seasonContext(deps.config), actorOf(req, admin), reason);
    changed();
    return reply.code(201).send(toAdmin(saved, deps.now().getTime()));
  });

  api.post<{ Params: { id: string } }>('/galaxy/api/admin/seasons/:id/schedule', async (req) => {
    const admin = requireAdmin(req);
    const { id } = seasonIdParamsSchema.parse(req.params);
    const { reason, password } = seasonActionBodySchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${admin.accountId}`, 'admin', 60, 60);
    await confirmPassword(deps.db, admin, password);
    const s = await scheduleSeason(deps.db, id, await seasonContext(deps.config), actorOf(req, admin), reason, { superadmin: admin.roles.includes('superadmin') });
    changed();
    return toAdmin(s, deps.now().getTime());
  });

  api.post<{ Params: { id: string } }>('/galaxy/api/admin/seasons/:id/unschedule', async (req) => {
    const admin = requireAdmin(req);
    const { id } = seasonIdParamsSchema.parse(req.params);
    const { reason, password } = seasonActionBodySchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${admin.accountId}`, 'admin', 60, 60);
    await confirmPassword(deps.db, admin, password);
    const s = await unscheduleSeason(deps.db, id, actorOf(req, admin), reason, deps.now());
    changed();
    return toAdmin(s, deps.now().getTime());
  });

  api.post<{ Params: { id: string } }>('/galaxy/api/admin/seasons/:id/extend', async (req) => {
    const admin = requireAdmin(req);
    const { id } = seasonIdParamsSchema.parse(req.params);
    const { endsAt, moveNext, reason, password } = seasonExtendBodySchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${admin.accountId}`, 'admin', 60, 60);
    await confirmPassword(deps.db, admin, password);
    const s = await extendSeason(deps.db, id, endsAt, { moveNext }, await seasonContext(deps.config), actorOf(req, admin), reason, deps.now());
    changed();
    return toAdmin(s, deps.now().getTime());
  });

  api.post<{ Params: { id: string } }>('/galaxy/api/admin/seasons/:id/delete', async (req, reply) => {
    const admin = requireAdmin(req);
    const { id } = seasonIdParamsSchema.parse(req.params);
    const { reason } = seasonDeleteBodySchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${admin.accountId}`, 'admin', 60, 60);
    await deleteSeasonDraft(deps.db, id, actorOf(req, admin), reason);
    changed();
    return reply.code(204).send();
  });
}
