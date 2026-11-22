import {
  type AdminTournament,
  type AdminTournamentCash,
  type AdminTournamentList,
  type AdminTournamentReview,
  type TournamentClaimResult,
  tournamentActionBodySchema,
  tournamentCashBodySchema,
  tournamentCheckParamsSchema,
  tournamentCreateBodySchema,
  tournamentDecideBodySchema,
  tournamentDecideManyBodySchema,
  type TournamentDecideManyResult,
  tournamentDeleteBodySchema,
  type TournamentDetail,
  tournamentDisqualifyBodySchema,
  type TournamentEntryResult,
  tournamentEntryParamsSchema,
  tournamentIdParamsSchema,
  type TournamentList,
  tournamentRecordSchema,
  tournamentScheduleBodySchema,
  tournamentSlugParamsSchema,
  tournamentUpdateBodySchema,
  type TournamentValidation,
  tournamentValidateBodySchema,
} from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { confirmPassword } from '../admin/players';
import type { AuditActor } from '../audit';
import { requireAdmin, requireSession } from '../auth/guards';
import type { SessionInfo } from '../auth/sessions';
import { operationExists } from '../economy/operations';
import { idempotencyKey } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { bigReasonsOf, cancelTournament, createTournament, deleteTournament, scheduleTournament, type TournamentDeps, unscheduleTournament, updateTournament } from './admin';
import { claimTournament, joinTournament, leaveTournament, tournamentDetail, tournamentList } from './player';
import { recordIssues, tournamentById, tournamentsIn } from './records';
import { adminTournamentOf, cashPrizes, decideCheck, decideMany, disqualifyEntry, finishTournament, markCashPaid, reviewView } from './review';

// The tournaments' routes (plan «temporadas como fichas», part 5; GDD §13.3). Players: the list, a tournament's page,
// and signing up, leaving and collecting with an `Idempotency-Key` (a resend answers from the stored operation without
// using up the limit). Admins, signed in with TOTP: everything about preparing and reviewing, each change with a reason
// and audited; scheduling, taking back, cancelling, publishing, deciding, disqualifying and marking money paid ask for
// the admin's password too. Request and answer types: packages/shared/src/api/tournaments.ts.

export function registerTournamentRoutes(api: FastifyInstance, deps: TournamentDeps & { trustCfIp: boolean }): void {
  const writeLimit = async (s: SessionInfo, key: string) => {
    if (!(await operationExists(deps.db, s.accountId, key))) await hitRateLimit(deps.db, `a:${s.accountId}`, 'tournament_entries', 30, 3600);
  };

  api.get('/galaxy/api/tournaments', async (req): Promise<TournamentList> => {
    const s = requireSession(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'tournaments', 120, 60);
    return tournamentList(deps, s.accountId);
  });

  api.get('/galaxy/api/tournaments/:slug', async (req): Promise<TournamentDetail> => {
    const s = requireSession(req);
    const { slug } = tournamentSlugParamsSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'tournaments', 120, 60);
    return tournamentDetail(deps, s.accountId, slug);
  });

  api.post('/galaxy/api/tournaments/:id/join', async (req): Promise<TournamentEntryResult> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { id } = tournamentIdParamsSchema.parse(req.params);
    await writeLimit(s, key);
    return joinTournament(deps, s.accountId, id, key);
  });

  api.post('/galaxy/api/tournaments/:id/leave', async (req): Promise<TournamentEntryResult> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { id } = tournamentIdParamsSchema.parse(req.params);
    await writeLimit(s, key);
    return leaveTournament(deps, s.accountId, id, key);
  });

  api.post('/galaxy/api/tournaments/:id/claim', async (req): Promise<TournamentClaimResult> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { id } = tournamentIdParamsSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'claims', 60, 60);
    return claimTournament(deps, s.accountId, id, key);
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Admins

  const actorOf = (req: FastifyRequest, s: SessionInfo): AuditActor => ({ id: s.accountId, label: s.username, ip: clientIp(req, deps.trustCfIp) });
  /** An admin's change: signed in with TOTP (checked before the body is read) and rate-limited. */
  const admin = async (req: FastifyRequest) => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 60, 60);
    return { s, actor: actorOf(req, s), confirm: (password: string) => confirmPassword(deps.db, s, password) };
  };
  const view = async (id: string): Promise<AdminTournament> => adminTournamentOf(deps, await tournamentById(deps.db, id));

  api.get('/galaxy/api/admin/tournaments', async (req): Promise<AdminTournamentList> => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 120, 60);
    const all = await tournamentsIn(deps.db, ['draft', 'scheduled', 'running', 'review', 'finished', 'cancelled'], (id, err) => req.log.error({ tournament: id, err: (err as Error).name }, 'tournament_invalid_stored_row'));
    return { tournaments: await Promise.all(all.map((t) => adminTournamentOf(deps, t))), now: deps.now().toISOString(), simVersion: SIM_VERSION };
  });

  api.get('/galaxy/api/admin/tournaments/cash', async (req): Promise<{ cash: AdminTournamentCash[] }> => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 120, 60);
    return { cash: await cashPrizes(deps.db) };
  });

  api.get('/galaxy/api/admin/tournaments/:id', async (req): Promise<AdminTournament> => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 120, 60);
    return view(tournamentIdParamsSchema.parse(req.params).id);
  });

  api.get('/galaxy/api/admin/tournaments/:id/review', async (req): Promise<AdminTournamentReview> => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 120, 60);
    return reviewView(deps, tournamentIdParamsSchema.parse(req.params).id);
  });

  api.post('/galaxy/api/admin/tournaments/validate', { bodyLimit: 256 * 1024 }, async (req): Promise<TournamentValidation> => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 120, 60);
    const { record, id } = tournamentValidateBodySchema.parse(req.body);
    const issues = await recordIssues(deps.db, deps.config, record, deps.now(), id ?? null);
    const parsed = tournamentRecordSchema.safeParse(record);
    if (parsed.success && Date.parse(parsed.data.endsAt) <= deps.now().getTime()) issues.push({ path: 'endsAt', message: 'tournament_end_past' });
    return { ok: issues.length === 0, issues, bigReasons: parsed.success ? await bigReasonsOf(deps.config, parsed.data) : [] };
  });

  api.post('/galaxy/api/admin/tournaments', { bodyLimit: 256 * 1024 }, async (req, reply) => {
    const { actor } = await admin(req);
    const body = tournamentCreateBodySchema.parse(req.body);
    const t = await createTournament(deps, actor, body.record, body.reason);
    return reply.code(201).send(await adminTournamentOf(deps, t));
  });

  api.post('/galaxy/api/admin/tournaments/:id', { bodyLimit: 256 * 1024 }, async (req): Promise<AdminTournament> => {
    const { actor } = await admin(req);
    const { id } = tournamentIdParamsSchema.parse(req.params);
    const body = tournamentUpdateBodySchema.parse(req.body);
    return adminTournamentOf(deps, await updateTournament(deps, actor, id, body.record, body.version, body.reason));
  });

  api.post('/galaxy/api/admin/tournaments/:id/delete', async (req, reply) => {
    const { actor } = await admin(req);
    const { id } = tournamentIdParamsSchema.parse(req.params);
    const { reason } = tournamentDeleteBodySchema.parse(req.body);
    await deleteTournament(deps, actor, id, reason);
    return reply.code(204).send();
  });

  api.post('/galaxy/api/admin/tournaments/:id/schedule', async (req): Promise<AdminTournament> => {
    const { s, actor, confirm } = await admin(req);
    const { id } = tournamentIdParamsSchema.parse(req.params);
    const { version, reason, password } = tournamentScheduleBodySchema.parse(req.body);
    await confirm(password);
    return adminTournamentOf(deps, await scheduleTournament(deps, s, actor, id, version, reason));
  });

  api.post('/galaxy/api/admin/tournaments/:id/unschedule', async (req): Promise<AdminTournament> => {
    const { actor, confirm } = await admin(req);
    const { id } = tournamentIdParamsSchema.parse(req.params);
    const { reason, password } = tournamentActionBodySchema.parse(req.body);
    await confirm(password);
    return adminTournamentOf(deps, await unscheduleTournament(deps, actor, id, reason));
  });

  api.post('/galaxy/api/admin/tournaments/:id/cancel', async (req): Promise<AdminTournament & { refunded: number }> => {
    const { actor, confirm } = await admin(req);
    const { id } = tournamentIdParamsSchema.parse(req.params);
    const { reason, password } = tournamentActionBodySchema.parse(req.body);
    await confirm(password);
    const { tournament, refunded } = await cancelTournament(deps, actor, id, reason);
    return { ...(await adminTournamentOf(deps, tournament)), refunded };
  });

  api.post('/galaxy/api/admin/tournaments/:id/publish', async (req): Promise<AdminTournamentReview> => {
    const { actor, confirm } = await admin(req);
    const { id } = tournamentIdParamsSchema.parse(req.params);
    const { reason, password } = tournamentActionBodySchema.parse(req.body);
    await confirm(password);
    await finishTournament(deps, id, { force: true, actor, reason });
    return reviewView(deps, id);
  });

  // In bulk, the undecided unverifiable ones matching the filter (the owner, 2026-11-22: «decidir en bloque»).
  api.post('/galaxy/api/admin/tournaments/:id/checks/decide-many', async (req): Promise<TournamentDecideManyResult> => {
    const { s, actor, confirm } = await admin(req);
    const { id } = tournamentIdParamsSchema.parse(req.params);
    const { decision, filter, reason, password } = tournamentDecideManyBodySchema.parse(req.body);
    await confirm(password);
    return decideMany(deps, s, actor, id, decision, filter, reason);
  });

  api.post('/galaxy/api/admin/tournaments/:id/checks/:run/decide', async (req): Promise<AdminTournamentReview> => {
    const { s, actor, confirm } = await admin(req);
    const { id, run } = tournamentCheckParamsSchema.parse(req.params);
    const { decision, reason, password } = tournamentDecideBodySchema.parse(req.body);
    await confirm(password);
    await decideCheck(deps, s, actor, id, run, decision, reason);
    return reviewView(deps, id);
  });

  api.post('/galaxy/api/admin/tournaments/:id/entries/:username/disqualify', async (req): Promise<AdminTournamentReview> => {
    const { s, actor, confirm } = await admin(req);
    const { id, username } = tournamentEntryParamsSchema.parse(req.params);
    const { disqualified, reason, password } = tournamentDisqualifyBodySchema.parse(req.body);
    await confirm(password);
    await disqualifyEntry(deps, s, actor, id, username, disqualified, reason);
    return reviewView(deps, id);
  });

  api.post('/galaxy/api/admin/tournaments/:id/cash/:username/paid', async (req): Promise<AdminTournamentCash> => {
    const { actor, confirm } = await admin(req);
    const { id, username } = tournamentEntryParamsSchema.parse(req.params);
    const { reason, password } = tournamentCashBodySchema.parse(req.body);
    await confirm(password);
    return markCashPaid(deps, actor, id, username, reason);
  });
}
