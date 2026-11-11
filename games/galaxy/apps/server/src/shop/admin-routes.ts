import {
  adminShopBlockSchema,
  adminShopCreatePricesSchema,
  adminShopPurchasesQuerySchema,
  adminShopReviewSchema,
  adminUsernameParamSchema,
} from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuditActor } from '../audit';
import { requireAdmin } from '../auth/guards';
import { confirmPassword } from '../admin/players';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { createMissingPrices, reviewShopAlert, setShopBlock, shopAlerts, shopBlocks, shopPurchases, shopSummary, syncPurchase, verifyPrices } from './admin';
import type { ShopDeps } from './service';

// The resource shop in the admin panel (shop and lab plan, F4): admins and superadmins signed in with TOTP. Reading
// is free; every change is rate limited and audited, and blocking, unblocking and making Stripe prices check the
// admin's own password.

const idParam = z.object({ id: z.uuid() }).strict();
const alertParam = z.object({ id: z.string().regex(/^\d{1,18}$/) }).strict();
const openQuery = z.object({ open: z.enum(['true', 'false']).default('true') }).strict();

export function registerShopAdminRoutes(api: FastifyInstance, deps: ShopDeps & { trustCfIp: boolean }): void {
  const actorOf = async (req: FastifyRequest) => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 60, 60);
    const actor: AuditActor = { id: s.accountId, label: s.username, ip: clientIp(req, deps.trustCfIp) };
    return { actor, session: s };
  };
  const A = '/galaxy/api/admin/shop';

  api.get(`${A}/summary`, async (req) => {
    requireAdmin(req);
    return shopSummary(deps);
  });

  api.get(`${A}/purchases`, async (req) => {
    requireAdmin(req);
    return shopPurchases(deps, adminShopPurchasesQuerySchema.parse(req.query));
  });

  api.post(`${A}/purchases/:id/sync`, async (req) => {
    await actorOf(req);
    return syncPurchase(deps, idParam.parse(req.params).id);
  });

  api.get(`${A}/alerts`, async (req) => {
    requireAdmin(req);
    return shopAlerts(deps, openQuery.parse(req.query).open === 'true');
  });

  api.post(`${A}/alerts/:id/review`, async (req) => {
    const { actor } = await actorOf(req);
    return reviewShopAlert(deps, actor, alertParam.parse(req.params).id, adminShopReviewSchema.parse(req.body).reason);
  });

  api.get(`${A}/blocks`, async (req) => {
    requireAdmin(req);
    return shopBlocks(deps);
  });

  for (const [path, blocked] of [
    ['block', true],
    ['unblock', false],
  ] as const) {
    api.post(`${A}/blocks/:username/${path}`, async (req) => {
      const { actor, session } = await actorOf(req);
      const { username } = adminUsernameParamSchema.parse(req.params);
      const body = adminShopBlockSchema.parse(req.body);
      await confirmPassword(deps.db, session, body.password);
      return setShopBlock(deps, actor, username, blocked, body.reason);
    });
  }

  api.post(`${A}/prices/verify`, async (req) => {
    await actorOf(req);
    return verifyPrices(deps);
  });

  api.post(`${A}/prices/create`, async (req) => {
    const { actor, session } = await actorOf(req);
    const body = adminShopCreatePricesSchema.parse(req.body);
    await confirmPassword(deps.db, session, body.password);
    return createMissingPrices(deps, actor, body.reason);
  });
}
