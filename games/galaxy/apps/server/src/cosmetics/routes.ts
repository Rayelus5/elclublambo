import { type CosmeticsView, profileCosmeticsSchema } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { requireSession } from '../auth/guards';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { hitRateLimit } from '../ratelimit';
import { cosmeticsView, setProfileCosmetics } from './service';

// «Personalizar» (Nov plan C2): what I wear and have, and choosing it. Same URL the missions screen used for title and
// frame, now for the avatar and the banner too.
export function registerCosmeticsRoutes(api: FastifyInstance, deps: { db: Kysely<DB>; config: ConfigReader }): void {
  api.get('/galaxy/api/profile/cosmetics', async (req): Promise<CosmeticsView> => {
    const s = requireSession(req);
    return cosmeticsView(deps.db, s.accountId, await deps.config.get('cosmetics'));
  });

  api.put('/galaxy/api/profile/cosmetics', async (req): Promise<CosmeticsView> => {
    const s = requireSession(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'cosmetics', 30, 60);
    const cfg = await deps.config.get('cosmetics');
    await setProfileCosmetics(deps.db, s.accountId, profileCosmeticsSchema.parse(req.body), cfg);
    return cosmeticsView(deps.db, s.accountId, cfg);
  });
}
