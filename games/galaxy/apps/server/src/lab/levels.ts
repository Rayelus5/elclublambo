import { type LabConfig, type LabEffects, labEffects, openSeasonId, type SeasonConfig } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';

// What an account has bought in the Laboratorio (GDD §10.6, M4b-2), read by the lab itself, the station (the refinery
// and the antenna), the runs (stat bonuses and pay) and the collection (disintegration and fusion). No imports from
// those services, so each can read it. The seasonal core (shop and lab plan, F2a) keeps its levels by season id: only
// the open season's count, so a new season starts it empty and between seasons it gives nothing.

export async function labLevels(db: Kysely<DB>, accountId: string): Promise<Record<string, number>> {
  const rows = await db.selectFrom('galaxy.lab_nodes').select(['node', 'level']).where('account_id', '=', accountId).execute();
  return Object.fromEntries(rows.map((r) => [r.node, r.level]));
}

/** The seasonal core's levels in one season. */
export async function seasonLabLevels(db: Kysely<DB>, accountId: string, seasonId: string): Promise<Record<string, number>> {
  const rows = await db.selectFrom('galaxy.lab_season_nodes').select(['node', 'level']).where('account_id', '=', accountId).where('season', '=', seasonId).execute();
  return Object.fromEntries(rows.map((r) => [r.node, r.level]));
}

/** The season whose seasonal core counts now: the open one, when the tree has nodes (null otherwise). */
export function labSeasonId(cfg: Pick<LabConfig, 'season'>, season: Pick<SeasonConfig, 'id' | 'startsAt' | 'endsAt'>, now: Date): string | null {
  return cfg.season.length > 0 ? openSeasonId(season, now) : null;
}

/** Both cores' effects; `seasonId` is the open season's (`labSeasonId`), or null to count only the permanent one. */
export async function accountLabEffects(db: Kysely<DB>, accountId: string, cfg: LabConfig, seasonId: string | null = null): Promise<LabEffects> {
  const [levels, season] = await Promise.all([labLevels(db, accountId), seasonId ? seasonLabLevels(db, accountId, seasonId) : null]);
  return labEffects(levels, cfg, season);
}
