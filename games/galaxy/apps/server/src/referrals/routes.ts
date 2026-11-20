import {
  adminReferralCodeCreateSchema,
  adminReferralCodeUpdateSchema,
  adminReferralListSchema,
  adminReferralOverrideSchema,
  adminReferralReviewSchema,
  adminUsernameParamSchema,
  type MyReferrals,
  type SignupOptions,
} from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { AuditActor } from '../audit';
import { requireAdmin, requireSession } from '../auth/guards';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import type { Env } from '../env';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { createCode, listCodes, listReferrals, myReferrals, ownerRules, referralSummary, reviewReferral, setOwnerRules, updateCode } from './service';

// Referrals' routes (plan «referidos»): what the sign-up form needs before anyone signs in, the owner's own view, and
// the admins' «Referidos» (TOTP admins only; every change audited and rate limited like the rest of the panel).

export type ReferralDeps = { db: Kysely<DB>; config: ConfigReader; env: Env };

export function registerReferralRoutes(api: FastifyInstance, deps: ReferralDeps): void {
  const { db } = deps;
  const actorOf = async (req: FastifyRequest): Promise<AuditActor> => {
    const s = requireAdmin(req);
    await hitRateLimit(db, `a:${s.accountId}`, 'admin', 60, 60);
    return { id: s.accountId, label: s.username, ip: clientIp(req, deps.env.TRUST_CF_IP) };
  };
  const owner = (req: FastifyRequest) => adminUsernameParamSchema.parse({ username: (req.params as { username: string }).username }).username;

  api.get('/galaxy/api/auth/signup-options', async (): Promise<SignupOptions> => ({ referralRequired: (await deps.config.get('referrals')).required }));

  api.get('/galaxy/api/referrals/mine', async (req): Promise<MyReferrals> => {
    const s = requireSession(req);
    return myReferrals(db, await deps.config.get('referrals'), s.accountId);
  });

  api.get('/galaxy/api/admin/referrals/summary', async (req) => {
    requireAdmin(req);
    return referralSummary(db);
  });

  api.get('/galaxy/api/admin/referrals/codes', async (req) => {
    requireAdmin(req);
    const { q } = z.object({ q: z.string().trim().max(40).optional() }).strict().parse(req.query);
    return listCodes(db, q);
  });

  api.post('/galaxy/api/admin/referrals/codes', async (req) => createCode(db, await actorOf(req), adminReferralCodeCreateSchema.parse(req.body)));

  api.put('/galaxy/api/admin/referrals/codes/:id', async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return updateCode(db, await actorOf(req), id, adminReferralCodeUpdateSchema.parse(req.body));
  });

  api.get('/galaxy/api/admin/referrals', async (req) => {
    requireAdmin(req);
    return listReferrals(db, await deps.config.get('account'), adminReferralListSchema.parse(req.query));
  });

  api.post('/galaxy/api/admin/referrals/:username/review', async (req) => {
    const actor = await actorOf(req);
    const body = adminReferralReviewSchema.parse(req.body);
    await reviewReferral(db, await deps.config.get('referrals'), actor, owner(req), body.decision, body.reason);
    return { ok: true };
  });

  api.get('/galaxy/api/admin/referrals/owners/:username', async (req) => {
    requireAdmin(req);
    return ownerRules(db, await deps.config.get('referrals'), owner(req));
  });

  api.put('/galaxy/api/admin/referrals/owners/:username', async (req) =>
    setOwnerRules(db, await deps.config.get('referrals'), await actorOf(req), owner(req), adminReferralOverrideSchema.parse(req.body)),
  );
}
