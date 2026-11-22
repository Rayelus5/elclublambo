import {
  type AdminPopup,
  type AdminPopupList,
  type AdminPopupResults,
  popupActionBodySchema,
  popupAnswerBodySchema,
  type PopupAnswerResult,
  popupCreateBodySchema,
  popupDeleteBodySchema,
  popupIdParamsSchema,
  type PopupNext,
  popupPublishBodySchema,
  popupRecordSchema,
  popupSeenBodySchema,
  type PopupTextsPage,
  popupTextsQuerySchema,
  popupUpdateBodySchema,
  type PopupValidation,
  popupValidateBodySchema,
} from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { confirmPassword } from '../admin/players';
import type { AuditActor } from '../audit';
import { requireAdmin, requireSession } from '../auth/guards';
import type { SessionInfo } from '../auth/sessions';
import { operationExists, runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { adminPopupOf, adminPopupsOf, bigReasonsOf, createPopup, deletePopup, endPopup, type PopupDeps, publishPopup, unpublishPopup, updatePopup } from './admin';
import { afterAnswer, popupAnswer, popupLater, popupNext, popupSeen, popupShown } from './player';
import { allPopups, popupById, recordIssues } from './records';
import { popupCsv, popupResults, popupTexts } from './results';

// The routes of «Encuestas y avisos» (plan 2026-11-22, part A; GDD §16.5). Players ask which popup to show, say it was
// shown, put it off, close a promotion and answer (with an `Idempotency-Key`: a resend answers from the stored operation
// without using up the limit), 30 requests a minute. Admins, signed in with TOTP, prepare the campaigns: each change
// with a reason and audited; publishing, taking back and ending ask for the admin's password too; and read the results.
// Request and answer types: packages/shared/src/api/popups.ts.

export function registerPopupRoutes(api: FastifyInstance, deps: PopupDeps & { trustCfIp: boolean }): void {
  /** A player's request: signed in, 30 a minute. */
  const player = async (req: FastifyRequest) => {
    const s = requireSession(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'popups', 30, 60);
    return s;
  };

  api.get('/galaxy/api/popups/next', async (req): Promise<PopupNext> => {
    const s = await player(req);
    return popupNext(deps, s.accountId);
  });

  api.post('/galaxy/api/popups/:id/shown', async (req, reply) => {
    const s = await player(req);
    await popupShown(deps, s.accountId, popupIdParamsSchema.parse(req.params).id);
    return reply.code(204).send();
  });

  api.post('/galaxy/api/popups/:id/later', async (req, reply) => {
    const s = await player(req);
    await popupLater(deps, s.accountId, popupIdParamsSchema.parse(req.params).id);
    return reply.code(204).send();
  });

  api.post('/galaxy/api/popups/:id/seen', async (req, reply) => {
    const s = await player(req);
    const { id } = popupIdParamsSchema.parse(req.params);
    const { clicked } = popupSeenBodySchema.parse(req.body);
    await popupSeen(deps, s.accountId, id, clicked);
    return reply.code(204).send();
  });

  api.post('/galaxy/api/popups/:id/answer', { bodyLimit: 64 * 1024 }, async (req): Promise<PopupAnswerResult> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { id } = popupIdParamsSchema.parse(req.params);
    const { answers } = popupAnswerBodySchema.parse(req.body);
    if (!(await operationExists(deps.db, s.accountId, key))) await hitRateLimit(deps.db, `a:${s.accountId}`, 'popups', 30, 60);
    let touched = false;
    const result = await runOperation(deps.db, s.accountId, key, 'popup_answer', requestHash({ id, answers }), async (trx) => {
      const out = await popupAnswer(trx, deps, s.accountId, id, answers, key);
      touched = out.seasonTouched;
      return out.result;
    });
    afterAnswer(touched);
    return result;
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
  /** An admin's read. */
  const reader = async (req: FastifyRequest) => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 120, 60);
    return s;
  };

  api.get('/galaxy/api/admin/popups', async (req): Promise<AdminPopupList> => {
    await reader(req);
    const all = await allPopups(deps.db, (id, err) => req.log.error({ popup: id, err: (err as Error).name }, 'popup_invalid_stored_row'));
    return { popups: await adminPopupsOf(deps, all), now: deps.now().toISOString() };
  });

  api.get('/galaxy/api/admin/popups/:id', async (req): Promise<AdminPopup> => {
    await reader(req);
    return adminPopupOf(deps, await popupById(deps.db, popupIdParamsSchema.parse(req.params).id));
  });

  // Everything that would keep the record from being published now (a draft saves without what only publishing needs).
  api.post('/galaxy/api/admin/popups/validate', { bodyLimit: 256 * 1024 }, async (req): Promise<PopupValidation> => {
    await reader(req);
    const { record } = popupValidateBodySchema.parse(req.body);
    const issues = await recordIssues(deps.db, deps.config, record, deps.now(), true);
    const parsed = popupRecordSchema.safeParse(record);
    return { ok: issues.length === 0, issues, bigReasons: parsed.success ? await bigReasonsOf(deps.config, parsed.data) : [] };
  });

  api.post('/galaxy/api/admin/popups', { bodyLimit: 256 * 1024 }, async (req, reply) => {
    const { actor } = await admin(req);
    const body = popupCreateBodySchema.parse(req.body);
    const p = await createPopup(deps, actor, body.record, body.reason);
    return reply.code(201).send(await adminPopupOf(deps, p));
  });

  api.post('/galaxy/api/admin/popups/:id', { bodyLimit: 256 * 1024 }, async (req): Promise<AdminPopup> => {
    const { actor } = await admin(req);
    const { id } = popupIdParamsSchema.parse(req.params);
    const body = popupUpdateBodySchema.parse(req.body);
    return adminPopupOf(deps, await updatePopup(deps, actor, id, body.record, body.version, body.reason));
  });

  api.post('/galaxy/api/admin/popups/:id/delete', async (req, reply) => {
    const { actor } = await admin(req);
    const { id } = popupIdParamsSchema.parse(req.params);
    const { reason } = popupDeleteBodySchema.parse(req.body);
    await deletePopup(deps, actor, id, reason);
    return reply.code(204).send();
  });

  api.post('/galaxy/api/admin/popups/:id/publish', async (req): Promise<AdminPopup> => {
    const { s, actor, confirm } = await admin(req);
    const { id } = popupIdParamsSchema.parse(req.params);
    const { version, reason, password } = popupPublishBodySchema.parse(req.body);
    await confirm(password);
    return adminPopupOf(deps, await publishPopup(deps, s, actor, id, version, reason));
  });

  api.post('/galaxy/api/admin/popups/:id/unpublish', async (req): Promise<AdminPopup> => {
    const { actor, confirm } = await admin(req);
    const { id } = popupIdParamsSchema.parse(req.params);
    const { reason, password } = popupActionBodySchema.parse(req.body);
    await confirm(password);
    return adminPopupOf(deps, await unpublishPopup(deps, actor, id, reason));
  });

  api.post('/galaxy/api/admin/popups/:id/end', async (req): Promise<AdminPopup> => {
    const { actor, confirm } = await admin(req);
    const { id } = popupIdParamsSchema.parse(req.params);
    const { reason, password } = popupActionBodySchema.parse(req.body);
    await confirm(password);
    return adminPopupOf(deps, await endPopup(deps, actor, id, reason));
  });

  api.get('/galaxy/api/admin/popups/:id/results', async (req): Promise<AdminPopupResults> => {
    await reader(req);
    return popupResults(deps, popupIdParamsSchema.parse(req.params).id);
  });

  api.get('/galaxy/api/admin/popups/:id/texts', async (req): Promise<PopupTextsPage> => {
    await reader(req);
    const { id } = popupIdParamsSchema.parse(req.params);
    const { question, cursor } = popupTextsQuerySchema.parse(req.query);
    return popupTexts(deps, id, question, cursor);
  });

  api.get('/galaxy/api/admin/popups/:id/results.csv', async (req, reply) => {
    await reader(req);
    const { row, csv } = await popupCsv(deps, popupIdParamsSchema.parse(req.params).id);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="encuesta-${row.id.slice(0, 8)}-${deps.now().toISOString().slice(0, 10)}.csv"`)
      .send(csv);
  });
}
