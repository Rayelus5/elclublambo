import {
  type AdminPopup,
  type AdminPopupList,
  popupActionBodySchema,
  popupCreateBodySchema,
  popupDeleteBodySchema,
  popupIdParamsSchema,
  popupPublishBodySchema,
  popupRecordSchema,
  popupUpdateBodySchema,
  type PopupValidation,
  popupValidateBodySchema,
} from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { confirmPassword } from '../admin/players';
import type { AuditActor } from '../audit';
import { requireAdmin } from '../auth/guards';
import type { SessionInfo } from '../auth/sessions';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { adminPopupOf, adminPopupsOf, bigReasonsOf, createPopup, deletePopup, endPopup, type PopupDeps, publishPopup, unpublishPopup, updatePopup } from './admin';
import { allPopups, popupById, recordIssues } from './records';

// The routes of «Encuestas y avisos» (plan 2026-11-22, part A; GDD §16.5). Admins, signed in with TOTP, prepare the
// campaigns: each change with a reason and audited; publishing, taking back and ending ask for the admin's password
// too. Request and answer types: packages/shared/src/api/popups.ts.

export function registerPopupRoutes(api: FastifyInstance, deps: PopupDeps & { trustCfIp: boolean }): void {
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
}
