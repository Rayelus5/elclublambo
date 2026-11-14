import {
  adminClanDissolveSchema,
  adminClanEditSchema,
  adminClanMemberSchema,
  adminClanQuerySchema,
  adminClanTagParamSchema,
  chatMessageParamSchema,
  modAuthorHideSchema,
  modChannelQuerySchema,
  modHideManySchema,
  modHideMuteSchema,
  modMuteSchema,
  modReasonSchema,
  modReportsQuerySchema,
  modResolveSchema,
  modUsernameParamSchema,
} from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuditActor } from '../audit';
import { requireAdmin, requireStaff } from '../auth/guards';
import type { SessionInfo } from '../auth/sessions';
import type { ChatDeps } from '../chat/service';
import type { Env } from '../env';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { adminClan, adminClans, adminDissolve, adminEditClan, adminKick, adminTransfer } from './clans';
import { modChannels, modDelete, modHide, modHideAuthor, modHideMany, modHideMute, modMessages, modMute, modMutes, modReports, modRestore, modUnmute, resolveReport } from './moderation';

// Moderation's routes (GDD §16.1, §16.4; M6c-1). The chats' (live view, hide and restore, the report queue, mutes)
// are for staff signed in with TOTP, moderators included; the clans' are for admins only (§16.1). Every change is rate
// limited (60 a minute, the panel's) and audited with the actor's IP.

export function registerModerationRoutes(api: FastifyInstance, deps: ChatDeps & { env: Env }): void {
  const actorOf = async (req: FastifyRequest, guard: (req: FastifyRequest) => SessionInfo): Promise<{ actor: AuditActor; session: SessionInfo }> => {
    const s = guard(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 60, 60);
    return { actor: { id: s.accountId, label: s.username, ip: clientIp(req, deps.env.TRUST_CF_IP) }, session: s };
  };
  const messageId = (req: FastifyRequest) => chatMessageParamSchema.parse(req.params).id;
  const clanTag = (req: FastifyRequest) => adminClanTagParamSchema.parse(req.params).tag;

  api.get('/galaxy/api/admin/moderation/channels', async (req) => {
    requireStaff(req);
    return modChannels(deps.db);
  });

  api.get('/galaxy/api/admin/moderation/messages', async (req) => {
    requireStaff(req);
    return modMessages(deps.db, modChannelQuerySchema.parse(req.query));
  });

  // The owner's chat asks (2026-11-14): many at once, what an account wrote lately, hide and mute, and delete.
  api.post('/galaxy/api/admin/moderation/messages/hide', async (req) => {
    const { actor } = await actorOf(req, requireStaff);
    const { ids, reason } = modHideManySchema.parse(req.body);
    return modHideMany(deps, actor, ids, reason);
  });

  api.post('/galaxy/api/admin/moderation/authors/:username/hide', async (req) => {
    const { actor, session } = await actorOf(req, requireStaff);
    const { username } = modUsernameParamSchema.parse(req.params);
    const { hours, reason } = modAuthorHideSchema.parse(req.body);
    return modHideAuthor(deps, actor, session, username, hours, reason);
  });

  api.post('/galaxy/api/admin/moderation/messages/:id/hide-mute', async (req) => {
    const { actor, session } = await actorOf(req, requireStaff);
    const { minutes, reason } = modHideMuteSchema.parse(req.body);
    return modHideMute(deps, actor, session, messageId(req), minutes, reason);
  });

  api.post('/galaxy/api/admin/moderation/messages/:id/delete', async (req) => {
    const { actor } = await actorOf(req, requireStaff);
    return modDelete(deps, actor, messageId(req), modReasonSchema.parse(req.body).reason);
  });

  api.post('/galaxy/api/admin/moderation/messages/:id/hide', async (req) => {
    const { actor } = await actorOf(req, requireStaff);
    return modHide(deps, actor, messageId(req), modReasonSchema.parse(req.body).reason);
  });

  api.post('/galaxy/api/admin/moderation/messages/:id/restore', async (req) => {
    const { actor } = await actorOf(req, requireStaff);
    return modRestore(deps, actor, messageId(req), modReasonSchema.parse(req.body).reason);
  });

  api.get('/galaxy/api/admin/moderation/reports', async (req) => {
    requireStaff(req);
    return modReports(deps.db, modReportsQuerySchema.parse(req.query).page);
  });

  api.post('/galaxy/api/admin/moderation/reports/:id', async (req) => {
    const { actor } = await actorOf(req, requireStaff);
    const { outcome, reason } = modResolveSchema.parse(req.body);
    return resolveReport(deps, actor, messageId(req), outcome, reason);
  });

  api.get('/galaxy/api/admin/moderation/mutes', async (req) => {
    requireStaff(req);
    return modMutes(deps.db, deps.now());
  });

  api.post('/galaxy/api/admin/moderation/mutes', async (req) => {
    const { actor, session } = await actorOf(req, requireStaff);
    return modMute(deps, actor, session, modMuteSchema.parse(req.body));
  });

  api.post('/galaxy/api/admin/moderation/mutes/:username/lift', async (req) => {
    const { actor, session } = await actorOf(req, requireStaff);
    const { username } = modUsernameParamSchema.parse(req.params);
    return modUnmute(deps, actor, session, username, modReasonSchema.parse(req.body).reason);
  });

  api.get('/galaxy/api/admin/clans', async (req) => {
    requireAdmin(req);
    return adminClans(deps.db, adminClanQuerySchema.parse(req.query).q);
  });

  api.get('/galaxy/api/admin/clans/:tag', async (req) => {
    requireAdmin(req);
    return adminClan(deps.db, clanTag(req));
  });

  api.post('/galaxy/api/admin/clans/:tag/edit', async (req) => {
    const { actor } = await actorOf(req, requireAdmin);
    return adminEditClan(deps, actor, clanTag(req), adminClanEditSchema.parse(req.body));
  });

  api.post('/galaxy/api/admin/clans/:tag/kick', async (req) => {
    const { actor, session } = await actorOf(req, requireAdmin);
    const { username, reason } = adminClanMemberSchema.parse(req.body);
    return adminKick(deps, actor, session, clanTag(req), username, reason);
  });

  api.post('/galaxy/api/admin/clans/:tag/leader', async (req) => {
    const { actor } = await actorOf(req, requireAdmin);
    const { username, reason } = adminClanMemberSchema.parse(req.body);
    return adminTransfer(deps, actor, clanTag(req), username, reason);
  });

  api.post('/galaxy/api/admin/clans/:tag/dissolve', async (req) => {
    const { actor, session } = await actorOf(req, requireAdmin);
    const { reason, password } = adminClanDissolveSchema.parse(req.body);
    return adminDissolve(deps, actor, session, clanTag(req), reason, password);
  });
}
