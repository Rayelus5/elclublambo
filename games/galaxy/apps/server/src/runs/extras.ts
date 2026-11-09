import { type RunResult, type SeasonConfig, seasonCurrency, shardsFor } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';
import { credit } from '../economy/wallet';
import { countStats, type MissionConfigs } from '../missions/service';

// What every paid run adds beyond its loot (solo and co-op): the season currency for the points it scored (M7d-1),
// and the missions and achievements for what it did as kept, if it was not suspicious (M7a).

export interface ExtrasContext {
  season: SeasonConfig;
  /** The season currency per point (seasonRoute.currency.perPoint). */
  perPoint: number;
  missions: MissionConfigs;
  now: Date;
}

export async function creditRunExtras(trx: Kysely<DB>, accountId: string, runId: string, r: RunResult, key: string, ctx: ExtrasContext): Promise<void> {
  const shards = shardsFor(r.progress.points, ctx.perPoint);
  if (shards > 0) {
    await credit(trx, accountId, seasonCurrency(ctx.season.id), shards, 'season_run', { run: runId }, key);
    r.progress.shards = shards;
  }
  const kept = await trx.selectFrom('galaxy.runs').select(['suspicious', 'seconds', 'kills', 'boss_kills', 'depth', 'outcome']).where('id', '=', runId).executeTakeFirstOrThrow();
  if (!kept.suspicious) {
    await countStats(
      trx,
      ctx.missions,
      accountId,
      { runs: 1, minutes: Math.floor((kept.seconds ?? 0) / 60), kills: kept.kills ?? 0, bossKills: kept.boss_kills ?? 0, extractions: kept.outcome === 'extracted' ? 1 : 0, depth: kept.depth ?? 0 },
      ctx.now,
    );
  }
}
