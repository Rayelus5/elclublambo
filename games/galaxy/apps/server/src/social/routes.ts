import { type Leaderboard, leaderboardQuerySchema, type Profile, type PublicCollectionPage, publicCollectionQuerySchema, usernameParamSchema } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/guards';
import { hitRateLimit } from '../ratelimit';
import { leaderboard, type SocialDeps } from './leaderboard';
import { profileOf, publicCollection } from './profiles';

// The social routes (GDD §14.1, §14.2; M5a): the season leaderboard, public profiles and public collections, for
// anyone signed in. The session is checked first, then the input.

export function registerSocialRoutes(api: FastifyInstance, deps: SocialDeps): void {
  api.get('/galaxy/api/leaderboard', async (req): Promise<Leaderboard> => {
    const s = requireSession(req);
    const { tab } = leaderboardQuerySchema.parse(req.query);
    return leaderboard(deps, s.accountId, tab);
  });

  api.get('/galaxy/api/profiles/:username', async (req): Promise<Profile> => {
    const s = requireSession(req);
    const { username } = usernameParamSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'profiles', 120, 60);
    return profileOf(deps, username);
  });

  api.get('/galaxy/api/profiles/:username/galaxies', async (req): Promise<PublicCollectionPage> => {
    const s = requireSession(req);
    const { username } = usernameParamSchema.parse(req.params);
    const q = publicCollectionQuerySchema.parse(req.query);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'profiles', 120, 60);
    return publicCollection(deps, username, q);
  });
}
