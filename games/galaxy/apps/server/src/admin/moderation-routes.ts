import { chatMessageParamSchema, modChannelQuerySchema, modMuteSchema, modReasonSchema, modResolveSchema, modUsernameParamSchema } from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuditActor } from '../audit';
import { requireStaff } from '../auth/guards';
import type { SessionInfo } from '../auth/sessions';
import type { ChatDeps } from '../chat/service';
import type { Env } from '../env';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { modChannels, modHide, modMessages, modMute, modMutes, modReports, modRestore, modUnmute, resolveReport } from './moderation';

// Moderation's routes (GDD §16.1, §16.4; M6c-1). The chats' (live view, hide and restore, the report queue, mutes)
// are for staff signed in with TOTP, moderators included. Every change is rate limited (60 a minute, the panel's) and
// audited with the actor's IP.

export function registerModerationRoutes(api: FastifyInstance, deps: ChatDeps & { env: Env }): void {
  const staffActor = async (req: FastifyRequest): Promise<{ actor: AuditActor; session: SessionInfo }> => {
    const s = requireStaff(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 60, 60);
    return { actor: { id: s.accountId, label: s.username, ip: clientIp(req, deps.env.TRUST_CF_IP) }, session: s };
  };
  const messageId = (req: FastifyRequest) => chatMessageParamSchema.parse(req.params).id;

  api.get('/galaxy/api/admin/moderation/channels', async (req) => {
    requireStaff(req);
    return modChannels(deps.db);
  });

  api.get('/galaxy/api/admin/moderation/messages', async (req) => {
    requireStaff(req);
    const { channel, before } = modChannelQuerySchema.parse(req.query);
    return modMessages(deps.db, channel, before);
  });

  api.post('/galaxy/api/admin/moderation/messages/:id/hide', async (req) => {
    const { actor } = await staffActor(req);
    return modHide(deps, actor, messageId(req), modReasonSchema.parse(req.body).reason);
  });

  api.post('/galaxy/api/admin/moderation/messages/:id/restore', async (req) => {
    const { actor } = await staffActor(req);
    return modRestore(deps, actor, messageId(req), modReasonSchema.parse(req.body).reason);
  });

  api.get('/galaxy/api/admin/moderation/reports', async (req) => {
    requireStaff(req);
    return modReports(deps.db);
  });

  api.post('/galaxy/api/admin/moderation/reports/:id', async (req) => {
    const { actor } = await staffActor(req);
    const { outcome, reason } = modResolveSchema.parse(req.body);
    return resolveReport(deps, actor, messageId(req), outcome, reason);
  });

  api.get('/galaxy/api/admin/moderation/mutes', async (req) => {
    requireStaff(req);
    return modMutes(deps.db, deps.now());
  });

  api.post('/galaxy/api/admin/moderation/mutes', async (req) => {
    const { actor, session } = await staffActor(req);
    return modMute(deps, actor, session, modMuteSchema.parse(req.body));
  });

  api.post('/galaxy/api/admin/moderation/mutes/:username/lift', async (req) => {
    const { actor, session } = await staffActor(req);
    const { username } = modUsernameParamSchema.parse(req.params);
    return modUnmute(deps, actor, session, username, modReasonSchema.parse(req.body).reason);
  });
}
