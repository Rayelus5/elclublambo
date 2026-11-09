import {
  ADMIN_SECTIONS,
  adminBanSchema,
  adminGalaxyGrantSchema,
  adminGalaxyRevokeSchema,
  adminLeaderboardSchema,
  adminReasonSchema,
  adminRenameSchema,
  adminSearchSchema,
  adminUsernameParamSchema,
  adminWalletSchema,
  adminXpSchema,
  auditQuerySchema,
} from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuditActor } from '../audit';
import { requireAdmin } from '../auth/guards';
import { issueResetCode } from '../auth/recovery';
import type { Env } from '../env';
import { HttpError } from '../errors';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import type { ChatHub } from '../chat/hub';
import { auditCsv, auditPage } from './audit-log';
import {
  type AdminDeps,
  banPlayer,
  changeWallet,
  closeSessions,
  confirmPassword,
  grantGalaxy,
  guardTarget,
  playerDetail,
  playerSection,
  renamePlayer,
  revokeGalaxy,
  searchPlayers,
  setLeaderboardExcluded,
  setXp,
  unbanPlayer,
} from './players';

// The admin panel's routes for players and the audit log (GDD §16.1, §16.2; M6a): admins and superadmins signed in
// with TOTP only. Every change is audited with the admin as its actor and their IP; destructive ones check the password.

const sectionParams = adminUsernameParamSchema.extend({ section: z.enum(ADMIN_SECTIONS) });
const galaxyParams = adminUsernameParamSchema.extend({ id: z.string().uuid() });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) }).strict();

export function registerAdminRoutes(api: FastifyInstance, deps: AdminDeps & { env: Env; hub: Pick<ChatHub, 'dropAccount'> }): void {
  /** The acting admin, with a rate limit on changes (60 a minute). */
  const actorOf = async (req: FastifyRequest, change: boolean): Promise<{ actor: AuditActor; session: ReturnType<typeof requireAdmin> }> => {
    const s = requireAdmin(req);
    if (change) await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 60, 60);
    return { actor: { id: s.accountId, label: s.username, ip: clientIp(req, deps.env.TRUST_CF_IP) }, session: s };
  };
  const user = (req: FastifyRequest) => adminUsernameParamSchema.parse({ username: (req.params as { username: string }).username }).username;

  api.get('/galaxy/api/admin/players', async (req) => {
    requireAdmin(req);
    return searchPlayers(deps, adminSearchSchema.parse(req.query).q);
  });

  api.get('/galaxy/api/admin/players/:username', async (req) => {
    requireAdmin(req);
    return playerDetail(deps, user(req));
  });

  api.get('/galaxy/api/admin/players/:username/:section', async (req) => {
    requireAdmin(req);
    const { username, section } = sectionParams.parse(req.params);
    return playerSection(deps, username, section, pageQuery.parse(req.query).page);
  });

  api.post('/galaxy/api/admin/players/:username/wallet', async (req) => {
    const { actor, session } = await actorOf(req, true);
    const body = adminWalletSchema.parse(req.body);
    await guardTarget(deps.db, session, user(req), { self: false });
    if (body.amount < 0) await confirmPassword(deps.db, session, body.password);
    return changeWallet(deps, actor, user(req), body);
  });

  api.post('/galaxy/api/admin/players/:username/galaxies', async (req) => {
    const { actor, session } = await actorOf(req, true);
    const body = adminGalaxyGrantSchema.parse(req.body);
    await guardTarget(deps.db, session, user(req), { self: false });
    return grantGalaxy(deps, actor, user(req), body);
  });

  api.post('/galaxy/api/admin/players/:username/galaxies/:id/revoke', async (req) => {
    const { actor, session } = await actorOf(req, true);
    const { username, id } = galaxyParams.parse(req.params);
    const body = adminGalaxyRevokeSchema.parse(req.body);
    await guardTarget(deps.db, session, username, { self: false });
    await confirmPassword(deps.db, session, body.password);
    return revokeGalaxy(deps, actor, username, id, body.reason);
  });

  api.post('/galaxy/api/admin/players/:username/xp', async (req) => {
    const { actor, session } = await actorOf(req, true);
    const body = adminXpSchema.parse(req.body);
    await guardTarget(deps.db, session, user(req), { self: false });
    await confirmPassword(deps.db, session, body.password);
    return setXp(deps, actor, user(req), body.xp, body.reason);
  });

  api.post('/galaxy/api/admin/players/:username/rename', async (req) => {
    const { actor, session } = await actorOf(req, true);
    const body = adminRenameSchema.parse(req.body);
    await guardTarget(deps.db, session, user(req), { self: false });
    await confirmPassword(deps.db, session, body.password);
    return renamePlayer(deps, actor, user(req), body.username, body.reason);
  });

  api.post('/galaxy/api/admin/players/:username/reset-code', async (req) => {
    const { actor, session } = await actorOf(req, true);
    const body = adminGalaxyRevokeSchema.parse(req.body);
    await guardTarget(deps.db, session, user(req), { self: false });
    await confirmPassword(deps.db, session, body.password);
    try {
      return { code: await issueResetCode(deps.db, user(req), actor, body.reason) };
    } catch (err) {
      if ((err as Error).name === 'AccountNotFoundError') throw new HttpError(404, 'player_not_found');
      throw err;
    }
  });

  api.post('/galaxy/api/admin/players/:username/sessions/close', async (req) => {
    const { actor, session } = await actorOf(req, true);
    const { reason } = adminReasonSchema.parse(req.body);
    const target = await guardTarget(deps.db, session, user(req), { self: true });
    const done = await closeSessions(deps, actor, user(req), reason);
    deps.hub.dropAccount(target.id);
    return done;
  });

  api.post('/galaxy/api/admin/players/:username/ban', async (req) => {
    const { actor, session } = await actorOf(req, true);
    const body = adminBanSchema.parse(req.body);
    const target = await guardTarget(deps.db, session, user(req), { self: false });
    await confirmPassword(deps.db, session, body.password);
    const done = await banPlayer(deps, actor, user(req), body.minutes, body.reason);
    deps.hub.dropAccount(target.id);
    return done;
  });

  api.post('/galaxy/api/admin/players/:username/unban', async (req) => {
    const { actor, session } = await actorOf(req, true);
    const { reason } = adminReasonSchema.parse(req.body);
    await guardTarget(deps.db, session, user(req), { self: false });
    return unbanPlayer(deps, actor, user(req), reason);
  });

  api.post('/galaxy/api/admin/players/:username/leaderboard', async (req) => {
    const { actor, session } = await actorOf(req, true);
    const body = adminLeaderboardSchema.parse(req.body);
    await guardTarget(deps.db, session, user(req), { self: false });
    return setLeaderboardExcluded(deps, actor, user(req), body.excluded, body.reason);
  });

  api.get('/galaxy/api/admin/audit', async (req, reply) => {
    requireAdmin(req);
    const raw = { ...(req.query as Record<string, unknown>) };
    const csv = raw['format'] === 'csv';
    delete raw['format'];
    const q = auditQuerySchema.parse(raw);
    if (!csv) return auditPage(deps.db, q);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(await auditCsv(deps.db, q));
  });
}
