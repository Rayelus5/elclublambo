import { adminStatsCsvQuerySchema, adminStatsQuerySchema } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth/guards';
import { adminStats, statsCsv, type StatsDeps } from './stats';
import { adminStorage, type Disk } from './storage';

// Live statistics' routes (GDD §16.1, §16.6; M6d-2): admins signed in with TOTP only; reading, so nothing is audited.

export function registerStatsRoutes(api: FastifyInstance, deps: StatsDeps & { disk: () => Promise<Disk | null> }): void {
  api.get('/galaxy/api/admin/stats', async (req) => {
    requireAdmin(req);
    return adminStats(deps, adminStatsQuerySchema.parse(req.query).period);
  });

  api.get('/galaxy/api/admin/stats.csv', async (req, reply) => {
    requireAdmin(req);
    const { period, section } = adminStatsCsvQuerySchema.parse(req.query);
    const body = statsCsv(await adminStats(deps, period), section);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="estadisticas-${section}-${period}-${deps.now().toISOString().slice(0, 10)}.csv"`)
      .send(body);
  });

  // «Almacenamiento»: what the server keeps and how much it weighs.
  api.get('/galaxy/api/admin/storage', async (req) => {
    requireAdmin(req);
    return adminStorage(deps);
  });
}
