import { createHash } from 'node:crypto';
import { leftoversSeenSchema, pullRequestSchema, seasonOpen, type GachaView, type PullResponse } from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/guards';
import { runOperation } from '../economy/operations';
import { HttpError } from '../errors';
import { hitRateLimit } from '../ratelimit';
import { withNotices } from '../realtime/notices';
import { countStats, missionConfigs } from '../missions/service';
import { markLeftoversSeen } from './leftovers';
import { enabledGacha, pull, visit, type GachaDeps } from './service';
import type { SessionInfo } from '../auth/sessions';

/** The client's `Idempotency-Key` header (a UUID): required on every economy action (GDD §11.3). */
export function idempotencyKey(req: FastifyRequest): string {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(key)) throw new HttpError(400, 'idempotency_required');
  return key;
}

/** Same body → same hash: a retry with the same key is recognised, a different request with it is a conflict. */
export function requestHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export function registerGachaRoutes(
  api: FastifyInstance,
  deps: GachaDeps & { shopFlag?: (s: SessionInfo) => Promise<NonNullable<GachaView['shop']>> },
): void {
  api.get('/galaxy/api/gacha', async (req): Promise<GachaView> => {
    const s = requireSession(req);
    const view = await visit(deps, s.accountId);
    // The shop's links and its «Oferta» sign come with the wallet every screen reads (shop and lab plan, F5).
    return deps.shopFlag ? { ...view, shop: await deps.shopFlag(s) } : view;
  });

  // The player has seen the window telling them their leftover event signals became star dust.
  api.post('/galaxy/api/gacha/leftovers/seen', async (req, reply) => {
    const s = requireSession(req);
    const body = leftoversSeenSchema.parse(req.body);
    await markLeftoversSeen(deps.db, s.accountId, body.ids, deps.now());
    return reply.code(204).send();
  });

  api.post('/galaxy/api/gacha/pull', async (req): Promise<PullResponse> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const body = pullRequestSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'gacha_pull', 30, 60);
    const gacha = await enabledGacha(deps.config);
    const seasonCfg = await deps.config.get('season');
    const season = seasonOpen(seasonCfg, deps.now()) ? seasonCfg : null;
    const mcfg = await missionConfigs(deps.config);
    return withNotices(deps.live, (out) =>
      runOperation(deps.db, s.accountId, key, 'gacha.pull', requestHash(body), async (trx) => {
        const r = await pull(deps, trx, s.accountId, body, key, gacha, season);
        await countStats(trx, mcfg, s.accountId, { pulls: r.pulls.length, legendaries: r.pulls.filter((p) => p.tier === 'legendary').length }, deps.now(), out);
        return r;
      }),
    );
  });
}
