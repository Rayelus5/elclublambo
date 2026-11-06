import { createHash } from 'node:crypto';
import { pullRequestSchema, type GachaView, type PullResponse } from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/guards';
import { runOperation } from '../economy/operations';
import { HttpError } from '../errors';
import { hitRateLimit } from '../ratelimit';
import { pull, visit, type GachaDeps } from './service';

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

export function registerGachaRoutes(api: FastifyInstance, deps: GachaDeps): void {
  api.get('/galaxy/api/gacha', async (req): Promise<GachaView> => {
    const s = requireSession(req);
    return visit(deps, s.accountId);
  });

  api.post('/galaxy/api/gacha/pull', async (req): Promise<PullResponse> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const body = pullRequestSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'gacha_pull', 30, 60);
    return runOperation(deps.db, s.accountId, key, 'gacha.pull', requestHash(body), (trx) => pull(deps, trx, s.accountId, body, key));
  });
}
