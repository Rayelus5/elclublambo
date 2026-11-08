import {
  adminGachaLuckSchema,
  adminLabNodeSchema,
  adminProbeGrantSchema,
  adminProbeSchema,
  adminRoomSchema,
  adminSeasonSchema,
  adminUsernameParamSchema,
} from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { requireAdmin } from '../auth/guards';
import type { Env } from '../env';
import { HttpError } from '../errors';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { guardTarget } from './players';
import { adjustSeason, progressOf, type ProgressDeps, setGachaLuck, setLabNode, setProbe, setProbeGrant, setRoom } from './progress';

// The «Progreso» routes of a player's page (GDD §16.1, §16.2; M6d-4): admins signed in with TOTP only, never on
// themselves, a superadmin, or (unless superadmin) other staff. Changes are rate-limited like every admin change.

export function registerAdminProgressRoutes(api: FastifyInstance, deps: ProgressDeps & { env: Env }): void {
  const user = (req: FastifyRequest) => adminUsernameParamSchema.parse({ username: (req.params as { username: string }).username }).username;
  /** The acting admin and the player acted on (guarded), with the rate limit on changes. */
  const acting = async (req: FastifyRequest) => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 60, 60);
    const { id } = await guardTarget(deps.db, s, user(req), { self: false });
    return { s, id, actor: { id: s.accountId, label: s.username, ip: clientIp(req, deps.env.TRUST_CF_IP) } };
  };

  api.get('/galaxy/api/admin/players/:username/progress', async (req) => {
    requireAdmin(req);
    const a = await deps.db.selectFrom('galaxy.accounts').select('id').where(sql<string>`lower(username)`, '=', user(req).toLowerCase()).executeTakeFirst();
    if (!a) throw new HttpError(404, 'player_not_found');
    return progressOf(deps, a.id);
  });

  api.post('/galaxy/api/admin/players/:username/gacha-luck', async (req) => {
    const { s, id, actor } = await acting(req);
    const body = adminGachaLuckSchema.parse(req.body);
    return setGachaLuck(deps, actor, s, id, body);
  });

  api.post('/galaxy/api/admin/players/:username/probe', async (req) => {
    const { s, id, actor } = await acting(req);
    const body = adminProbeSchema.parse(req.body);
    return setProbe(deps, actor, s, id, body);
  });

  api.post('/galaxy/api/admin/players/:username/probe-grant', async (req) => {
    const { s, id, actor } = await acting(req);
    const body = adminProbeGrantSchema.parse(req.body);
    return setProbeGrant(deps, actor, s, id, body);
  });

  api.post('/galaxy/api/admin/players/:username/room', async (req) => {
    const { s, id, actor } = await acting(req);
    const body = adminRoomSchema.parse(req.body);
    return setRoom(deps, actor, s, id, body);
  });

  api.post('/galaxy/api/admin/players/:username/lab-node', async (req) => {
    const { s, id, actor } = await acting(req);
    const body = adminLabNodeSchema.parse(req.body);
    return setLabNode(deps, actor, s, id, body);
  });

  api.post('/galaxy/api/admin/players/:username/season', async (req) => {
    const { s, id, actor } = await acting(req);
    const body = adminSeasonSchema.parse(req.body);
    return adjustSeason(deps, actor, s, id, body);
  });
}
