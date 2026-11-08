import { adminAlertParamSchema, adminAlertsQuerySchema, adminDealParamSchema, adminDealsQuerySchema, adminLineageQuerySchema, adminReasonSchema, adminRevertSchema } from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuditActor } from '../audit';
import { requireAdmin } from '../auth/guards';
import type { SessionInfo } from '../auth/sessions';
import type { Env } from '../env';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { type AdminMarketDeps, adminAlerts, adminCancelListing, adminCancelTrade, adminDeals, dealLineage, revertSale, revertTrade, reviewAlert } from './market';

// Trade moderation's routes (GDD §16.1, §16.4; M6c-2): admins signed in with TOTP only. Every change is rate limited
// (the panel's 60 a minute) and audited with the admin's IP; reverting also asks for their password.

export function registerAdminMarketRoutes(api: FastifyInstance, deps: AdminMarketDeps & { env: Env }): void {
  const actorOf = async (req: FastifyRequest): Promise<{ actor: AuditActor; session: SessionInfo }> => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 60, 60);
    return { actor: { id: s.accountId, label: s.username, ip: clientIp(req, deps.env.TRUST_CF_IP) }, session: s };
  };
  const dealId = (req: FastifyRequest) => adminDealParamSchema.parse(req.params).id;

  api.get('/galaxy/api/admin/market/deals', async (req) => {
    requireAdmin(req);
    return adminDeals(deps.db, adminDealsQuerySchema.parse(req.query));
  });

  api.get('/galaxy/api/admin/market/lineage', async (req) => {
    requireAdmin(req);
    const { kind, id } = adminLineageQuerySchema.parse(req.query);
    return dealLineage(deps.db, kind, id);
  });

  api.post('/galaxy/api/admin/market/listings/:id/cancel', async (req) => {
    const { actor } = await actorOf(req);
    return adminCancelListing(deps, actor, dealId(req), adminReasonSchema.parse(req.body).reason);
  });

  api.post('/galaxy/api/admin/market/trades/:id/cancel', async (req) => {
    const { actor } = await actorOf(req);
    return adminCancelTrade(deps, actor, dealId(req), adminReasonSchema.parse(req.body).reason);
  });

  api.post('/galaxy/api/admin/market/listings/:id/revert', async (req) => {
    const { actor, session } = await actorOf(req);
    const { reason, password } = adminRevertSchema.parse(req.body);
    return revertSale(deps, actor, session, dealId(req), reason, password);
  });

  api.post('/galaxy/api/admin/market/trades/:id/revert', async (req) => {
    const { actor, session } = await actorOf(req);
    const { reason, password } = adminRevertSchema.parse(req.body);
    return revertTrade(deps, actor, session, dealId(req), reason, password);
  });

  api.get('/galaxy/api/admin/market/alerts', async (req) => {
    requireAdmin(req);
    return adminAlerts(deps.db, adminAlertsQuerySchema.parse(req.query));
  });

  api.post('/galaxy/api/admin/market/alerts/:id/review', async (req) => {
    const { actor } = await actorOf(req);
    return reviewAlert(deps, actor, adminAlertParamSchema.parse(req.params).id, adminReasonSchema.parse(req.body).reason);
  });
}
