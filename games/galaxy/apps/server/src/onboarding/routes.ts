import type { OnboardingView } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { type Kysely, sql } from 'kysely';
import { requireSession } from '../auth/guards';
import type { DB } from '../db/schema';

// The first steps (GDD §12.2; M7c): the probe test, the first run, the welcome pulls, the first room repaired and the
// first relic equipped — read from what the account has, so they tick themselves.

export function registerOnboardingRoutes(api: FastifyInstance, deps: { db: Kysely<DB> }): void {
  api.get('/galaxy/api/onboarding', async (req): Promise<OnboardingView> => {
    const s = requireSession(req);
    const id = s.accountId;
    const { rows } = await sql<{ test: boolean; run: boolean; pulls: boolean; room: boolean; relic: boolean }>`
      select
        exists (select 1 from galaxy.probe_tests where account_id = ${id}) as test,
        exists (select 1 from galaxy.runs where account_id = ${id} and finished_at is not null) as run,
        exists (select 1 from galaxy.gacha_pulls where account_id = ${id}) as pulls,
        exists (select 1 from galaxy.station_rooms where account_id = ${id} and room in ('antenna', 'lab') and level > 0) as room,
        exists (select 1 from galaxy.loadouts where account_id = ${id}) as relic`.execute(deps.db);
    const r = rows[0]!;
    return { probeTest: r.test, firstRun: r.run, welcomePulls: r.pulls, repairRoom: r.room, equipRelic: r.relic };
  });
}
