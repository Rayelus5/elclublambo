import { clanCreateSchema, clanEditSchema, clanMemberParamSchema, clanSearchSchema, clanTagParamSchema, type ClanList, type ClanView, type MyClan } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/guards';
import { runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import type { SocialDeps } from '../social/leaderboard';
import { answerRequest, cancelRequest, clanConfigs, createClan, editClan, joinClan, leaveClan, listClans, manageMember, myClan, viewByTag } from './service';

// The clans' routes (GDD §14.3; M5b-1), for anyone signed in. Creating a clan charges coins, so it is an idempotent
// operation; every change is limited per account. The session is checked first, then the input.

export function registerClanRoutes(api: FastifyInstance, deps: SocialDeps): void {
  const limited = (accountId: string) => hitRateLimit(deps.db, `a:${accountId}`, 'clans', 60, 60);

  api.get('/galaxy/api/clans', async (req): Promise<ClanList> => {
    requireSession(req);
    const { q } = clanSearchSchema.parse(req.query);
    return listClans(deps, q);
  });

  api.get('/galaxy/api/clans/mine', async (req): Promise<MyClan> => {
    const s = requireSession(req);
    return myClan(deps, s.accountId);
  });

  api.get('/galaxy/api/clans/:tag', async (req): Promise<ClanView> => {
    const s = requireSession(req);
    const { tag } = clanTagParamSchema.parse(req.params);
    return viewByTag(deps, s.accountId, tag);
  });

  api.post('/galaxy/api/clans', async (req): Promise<ClanView> => {
    const s = requireSession(req);
    const body = clanCreateSchema.parse(req.body);
    const key = idempotencyKey(req);
    await limited(s.accountId);
    const cfgs = await clanConfigs(deps);
    const now = deps.now();
    return runOperation(deps.db, s.accountId, key, 'clans.create', requestHash(body), (trx) => createClan(trx, s.accountId, body, key, cfgs, now));
  });

  api.patch('/galaxy/api/clans/:tag', async (req): Promise<ClanView> => {
    const s = requireSession(req);
    const { tag } = clanTagParamSchema.parse(req.params);
    const body = clanEditSchema.parse(req.body);
    await limited(s.accountId);
    return editClan(deps, s.accountId, tag, body);
  });

  for (const [path, asRequest] of [['join', false], ['request', true]] as const) {
    api.post(`/galaxy/api/clans/:tag/${path}`, async (req): Promise<ClanView> => {
      const s = requireSession(req);
      const { tag } = clanTagParamSchema.parse(req.params);
      await limited(s.accountId);
      return joinClan(deps, s.accountId, tag, asRequest);
    });
  }

  api.post('/galaxy/api/clans/:tag/request/cancel', async (req): Promise<ClanView> => {
    const s = requireSession(req);
    const { tag } = clanTagParamSchema.parse(req.params);
    await limited(s.accountId);
    return cancelRequest(deps, s.accountId, tag);
  });

  for (const answer of ['accept', 'reject'] as const) {
    api.post(`/galaxy/api/clans/:tag/requests/:username/${answer}`, async (req): Promise<ClanView> => {
      const s = requireSession(req);
      const { tag, username } = clanMemberParamSchema.parse(req.params);
      await limited(s.accountId);
      return answerRequest(deps, s.accountId, tag, username, answer === 'accept');
    });
  }

  for (const action of ['kick', 'promote', 'demote', 'transfer'] as const) {
    api.post(`/galaxy/api/clans/:tag/members/:username/${action}`, async (req): Promise<ClanView> => {
      const s = requireSession(req);
      const { tag, username } = clanMemberParamSchema.parse(req.params);
      await limited(s.accountId);
      return manageMember(deps, s.accountId, tag, username, action);
    });
  }

  api.post('/galaxy/api/clans/:tag/leave', async (req): Promise<MyClan> => {
    const s = requireSession(req);
    const { tag } = clanTagParamSchema.parse(req.params);
    await limited(s.accountId);
    return leaveClan(deps, s.accountId, tag);
  });
}
