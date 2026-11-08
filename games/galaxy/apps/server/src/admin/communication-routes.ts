import { adminMailPreviewSchema, adminMailSendSchema, adminNoticeSchema, adminReasonSchema, mailIdParamSchema } from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuditActor } from '../audit';
import { requireAdmin } from '../auth/guards';
import type { SessionInfo } from '../auth/sessions';
import type { Env } from '../env';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { adminMail, adminNotices, type CommunicationDeps, createNotice, endNotice, previewMail, sendMail, withdrawMail } from './communication';

// Communication's routes (GDD §16.1, §16.5; M6d-1): admins signed in with TOTP only. Every change is rate limited (the
// panel's 60 a minute) and audited with the admin's IP; a message with gifts also asks for the password.

export function registerCommunicationRoutes(api: FastifyInstance, deps: CommunicationDeps & { env: Env }): void {
  const actorOf = async (req: FastifyRequest): Promise<{ actor: AuditActor; session: SessionInfo }> => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 60, 60);
    return { actor: { id: s.accountId, label: s.username, ip: clientIp(req, deps.env.TRUST_CF_IP) }, session: s };
  };
  const id = (req: FastifyRequest) => mailIdParamSchema.parse(req.params).id;

  api.get('/galaxy/api/admin/mail', async (req) => {
    requireAdmin(req);
    return adminMail(deps);
  });

  api.post('/galaxy/api/admin/mail/preview', async (req) => {
    requireAdmin(req);
    return previewMail(deps, adminMailPreviewSchema.parse(req.body).audience);
  });

  api.post('/galaxy/api/admin/mail', async (req) => {
    const { actor, session } = await actorOf(req);
    return sendMail(deps, actor, session, adminMailSendSchema.parse(req.body));
  });

  api.post('/galaxy/api/admin/mail/:id/withdraw', async (req) => {
    const { actor } = await actorOf(req);
    return withdrawMail(deps, actor, id(req), adminReasonSchema.parse(req.body).reason);
  });

  api.get('/galaxy/api/admin/notices', async (req) => {
    requireAdmin(req);
    return adminNotices(deps);
  });

  api.post('/galaxy/api/admin/notices', async (req) => {
    const { actor } = await actorOf(req);
    return createNotice(deps, actor, adminNoticeSchema.parse(req.body));
  });

  api.post('/galaxy/api/admin/notices/:id/end', async (req) => {
    const { actor } = await actorOf(req);
    return endNotice(deps, actor, id(req), adminReasonSchema.parse(req.body).reason);
  });
}
