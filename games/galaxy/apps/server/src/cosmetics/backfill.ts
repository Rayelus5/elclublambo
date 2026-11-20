import type { Content } from '@galaxy/sim';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';
import { grantCosmetics, grantPortraits } from './service';

// The one-off backfill of the November cosmetics (Nov plan C2, ruling 15): who already beat a Núcleo gets its portrait,
// and who already collected an achievement, a catalog step or a season route step that now gives an avatar or a new
// frame gets it. Safe to run again: every grant ignores what the player already has.

type Reward = { title?: string | null; frame?: string | null; avatar?: string | null };

export interface BackfillConfigs {
  content: Content;
  achievements: { id: string; reward: Reward }[];
  catalog: { percent: number; reward: Reward }[];
  route: { at: number; reward: Reward }[];
  season: string;
}

export async function backfillCosmetics(db: Kysely<DB>, c: BackfillConfigs): Promise<{ portraits: number; achievements: number; catalog: number; route: number }> {
  const out = { portraits: 0, achievements: 0, catalog: 0, route: 0 };
  const runs = await db
    .selectFrom('galaxy.runs')
    .select(['account_id', 'sector', 'depth', 'boss_kills'])
    .where('boss_kills', '>', 0)
    .where('suspicious', '=', false)
    .execute();
  for (const r of runs) {
    const sector = c.content.sectors.find((s) => s.id === r.sector);
    if (!sector) continue;
    await grantPortraits(db, r.account_id, { boss: sector.boss, deepBoss: sector.deepBoss, depth: r.depth ?? 0, bossKills: r.boss_kills ?? 0 });
    out.portraits++;
  }
  for (const a of c.achievements.filter((x) => x.reward.avatar || x.reward.frame || x.reward.title)) {
    const who = await db.selectFrom('galaxy.achievement_progress').select('account_id').where('achievement', '=', a.id).where('claimed_at', 'is not', null).execute();
    for (const w of who) await grantCosmetics(db, w.account_id, a.reward);
    out.achievements += who.length;
  }
  for (const step of c.catalog.filter((x) => x.reward.avatar || x.reward.frame || x.reward.title)) {
    const who = await db.selectFrom('galaxy.catalog_claims').select('account_id').where('percent', '=', step.percent).execute();
    for (const w of who) await grantCosmetics(db, w.account_id, step.reward);
    out.catalog += who.length;
  }
  for (const step of c.route.filter((x) => x.reward.avatar || x.reward.frame || x.reward.title)) {
    const who = await db.selectFrom('galaxy.season_route_claims').select('account_id').where('season', '=', c.season).where('step', '=', step.at).execute();
    for (const w of who) await grantCosmetics(db, w.account_id, step.reward);
    out.route += who.length;
  }
  return out;
}
