import { refineryLoadSchema, roomUpgradeSchema, type StationView } from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { requireSession } from '../auth/guards';
import type { DB } from '../db/schema';
import { runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import type { RunsDeps } from '../runs/hangar';
import { collectAntenna, collectRefinery, loadRefinery, stationView, upgradeRoom } from './service';
import { missionConfigs } from '../missions/service';

// The station's routes (GDD §10): the view, and four idempotent actions that answer with the new view.

const roomParam = z.object({ id: z.string().regex(/^[a-z0-9-]{1,32}$/) }).strict();
const empty = z.object({}).strict().optional();

export function registerStationRoutes(api: FastifyInstance, deps: RunsDeps): void {
  api.get('/galaxy/api/station', async (req): Promise<StationView> => {
    const s = requireSession(req);
    return stationView(deps, s.accountId);
  });

  /** One action: session, key, rate limit, then the operation (a retry with its key gets the stored answer). */
  async function action(
    req: FastifyRequest,
    name: string,
    body: unknown,
    run: (accountId: string, key: string, trx: Kysely<DB>) => Promise<StationView>,
  ): Promise<StationView> {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'station', 60, 60);
    return runOperation(deps.db, s.accountId, key, `station.${name}`, requestHash({ name, body }), (trx) => run(s.accountId, key, trx));
  }

  api.post('/galaxy/api/station/refinery/load', async (req) => {
    const body = refineryLoadSchema.parse(req.body);
    return action(req, 'refinery.load', body, (account, key, trx) => loadRefinery(deps, trx, account, body.amount, key));
  });
  api.post('/galaxy/api/station/refinery/collect', async (req) => {
    empty.parse(req.body ?? undefined);
    const mcfg = await missionConfigs(deps.config);
    return action(req, 'refinery.collect', null, (account, key, trx) => collectRefinery(deps, trx, account, key, mcfg));
  });
  api.post('/galaxy/api/station/antenna/collect', async (req) => {
    empty.parse(req.body ?? undefined);
    return action(req, 'antenna.collect', null, (account, key, trx) => collectAntenna(deps, trx, account, key));
  });
  api.post('/galaxy/api/station/rooms/:id/upgrade', async (req) => {
    const { id } = roomParam.parse(req.params);
    const { level } = roomUpgradeSchema.parse(req.body);
    return action(req, 'room.upgrade', { id, level }, (account, key, trx) => upgradeRoom(deps, trx, account, id, level, key));
  });
}
