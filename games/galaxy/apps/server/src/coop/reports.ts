import { type PlayerReport, type PlayerReportPage, playerReportReviewSchema, playerReportSchema } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import { writeAudit } from '../audit';
import { requireSession, requireStaff } from '../auth/guards';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { clientIp } from '../security/client-ip';

// Reports of a player (multiplayer plan, phase 7): a teammate of a group run reports another one of it (idle, playing
// against the group, cheating, abuse or other, with an optional note), once per run; nobody outside the run may. The
// staff review the queue, oldest waiting last, and every review is audited.

const PAGE = 50;
/** Reports one account may send in an hour. */
const PER_HOUR = 20;
const runParam = z.object({ id: z.uuid() }).strict();
const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) }).strict();

export function registerPlayerReportRoutes(api: FastifyInstance, deps: { db: Kysely<DB>; trustCfIp: boolean }): void {
  const { db } = deps;

  api.post('/galaxy/api/coop/runs/:id/report', async (req): Promise<{ reported: true }> => {
    const s = requireSession(req);
    const { id } = runParam.parse(req.params);
    const body = playerReportSchema.parse(req.body);
    if (body.username === s.username.toLowerCase()) throw new HttpError(400, 'invalid_input');
    const players = await db
      .selectFrom('galaxy.runs as r')
      .innerJoin('galaxy.accounts as a', 'a.id', 'r.account_id')
      .select(['r.account_id', 'a.username'])
      .where('r.coop_run_id', '=', id)
      .execute();
    const target = players.find((p) => p.username.toLowerCase() === body.username);
    if (!players.some((p) => p.account_id === s.accountId) || !target) throw new HttpError(403, 'forbidden');
    const recent = await db
      .selectFrom('galaxy.player_reports')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('reporter_id', '=', s.accountId)
      .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
      .executeTakeFirstOrThrow();
    if (recent.n >= PER_HOUR) throw new HttpError(429, 'rate_limited');
    await db
      .insertInto('galaxy.player_reports')
      .values({ reporter_id: s.accountId, reported_id: target.account_id, coop_run_id: id, reason: body.reason, note: body.note || null })
      .onConflict((oc) => oc.columns(['reporter_id', 'reported_id', 'coop_run_id']).doNothing())
      .execute();
    return { reported: true };
  });

  api.get('/galaxy/api/admin/moderation/player-reports', async (req): Promise<PlayerReportPage> => {
    requireStaff(req);
    const { page } = pageQuery.parse(req.query);
    const pending = db.selectFrom('galaxy.player_reports as p').where('p.reviewed_at', 'is', null);
    const [{ total }, rows] = await Promise.all([
      pending.select(sql<number>`count(*)::int`.as('total')).executeTakeFirstOrThrow(),
      pending
        .innerJoin('galaxy.accounts as ra', 'ra.id', 'p.reporter_id')
        .innerJoin('galaxy.accounts as rd', 'rd.id', 'p.reported_id')
        .innerJoin('galaxy.coop_runs as c', 'c.id', 'p.coop_run_id')
        .leftJoin('galaxy.runs as rr', (j) => j.onRef('rr.coop_run_id', '=', 'p.coop_run_id').onRef('rr.account_id', '=', 'p.reported_id'))
        .select(['p.id', 'ra.username as reporter', 'rd.username as reported', 'p.reason', 'p.note', 'p.created_at', 'p.coop_run_id', 'rr.id as reported_run', 'c.sector'])
        .orderBy('p.created_at', 'desc')
        .limit(PAGE)
        .offset((page - 1) * PAGE)
        .execute(),
    ]);
    const reports: PlayerReport[] = rows.map((r) => ({
      id: r.id,
      reporter: r.reporter,
      reported: r.reported,
      reason: r.reason as PlayerReport['reason'],
      note: r.note,
      at: new Date(r.created_at).toISOString(),
      coopRunId: r.coop_run_id,
      reportedRunId: r.reported_run,
      sector: r.sector,
    }));
    return { reports, total, page, pages: Math.max(1, Math.ceil(total / PAGE)) };
  });

  api.post('/galaxy/api/admin/moderation/player-reports/:id', async (req): Promise<{ reviewed: true }> => {
    const staff = requireStaff(req);
    const { id } = runParam.parse(req.params);
    const { outcome, reason: note } = playerReportReviewSchema.parse(req.body);
    const actor = { id: staff.accountId, label: staff.username, ip: clientIp(req, deps.trustCfIp) };
    await inTransaction(db, async (trx) => {
      const r = await trx
        .selectFrom('galaxy.player_reports as p')
        .innerJoin('galaxy.accounts as rd', 'rd.id', 'p.reported_id')
        .select(['p.reviewed_at', 'p.reason', 'rd.username as reported'])
        .where('p.id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!r) throw new HttpError(404, 'not_found');
      if (r.reviewed_at) throw new HttpError(409, 'report_reviewed');
      await trx.updateTable('galaxy.player_reports').set({ reviewed_at: new Date(), reviewed_by: staff.accountId, outcome, review_note: note }).where('id', '=', id).execute();
      await writeAudit(trx, { actor, action: 'player_report.review', targetType: 'player_report', targetId: id, before: { reported: r.reported, reason: r.reason }, after: { outcome }, reason: note });
    });
    return { reviewed: true };
  });
}
