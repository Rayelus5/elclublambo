import { exhibitsSchema, type PlanetariumView, type PlanetariumVisit, usernameParamSchema } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/guards';
import { hitRateLimit } from '../ratelimit';
import { type PlanetariumDeps, planetariumView, setExhibits, visitPlanetarium } from './service';

// The planetarium's routes (GDD §10.5, §14.2; M4c-2): one's own planetarium, what each pedestal holds, and a visit to
// someone else's by name. Exhibiting moves no currency, so it is not an idempotent operation (like the loadout).
// The session is checked first, then the input.

export function registerPlanetariumRoutes(api: FastifyInstance, deps: PlanetariumDeps): void {
  api.get('/galaxy/api/planetarium', async (req): Promise<PlanetariumView> => {
    const s = requireSession(req);
    return planetariumView(deps, s.accountId);
  });

  api.put('/galaxy/api/planetarium/exhibits', async (req): Promise<PlanetariumView> => {
    const s = requireSession(req);
    const body = exhibitsSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'planetarium_exhibits', 60, 60);
    return setExhibits(deps, s.accountId, body);
  });

  api.get('/galaxy/api/planetarium/visit/:username', async (req): Promise<PlanetariumVisit> => {
    const s = requireSession(req);
    const { username } = usernameParamSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'planetarium_visit', 120, 60);
    return visitPlanetarium(deps, s.accountId, username);
  });
}
