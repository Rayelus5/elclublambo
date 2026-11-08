import { adminRunMarkSchema, adminRunParamSchema, adminRunsQuerySchema } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { requireAdmin } from '../auth/guards';
import type { DB } from '../db/schema';
import type { Env } from '../env';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { listRuns, markRun, runReplay } from './runs';

// The panel's runs' routes (GDD §16.1, §16.2, §16.6; M6d-3): admins signed in with TOTP only. A mark is audited with the
// admin as its actor and their IP, and rate-limited like every other change.

export function registerAdminRunRoutes(api: FastifyInstance, deps: { db: Kysely<DB>; env: Env }): void {
  api.get('/galaxy/api/admin/runs', async (req) => {
    requireAdmin(req);
    return listRuns(deps.db, adminRunsQuerySchema.parse(req.query));
  });

  api.get('/galaxy/api/admin/runs/:id', async (req) => {
    requireAdmin(req);
    return runReplay(deps.db, adminRunParamSchema.parse(req.params).id);
  });

  api.post('/galaxy/api/admin/runs/:id/mark', async (req) => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 60, 60);
    const { id } = adminRunParamSchema.parse(req.params);
    const body = adminRunMarkSchema.parse(req.body);
    return markRun(deps.db, { id: s.accountId, label: s.username, ip: clientIp(req, deps.env.TRUST_CF_IP) }, s, id, body);
  });
}
