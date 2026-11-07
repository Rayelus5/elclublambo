import { type LabConfig, type LabEffects, labEffects } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';

// What an account has bought in the Laboratorio (GDD §10.6, M4b-2), read by the lab itself, the station (the refinery
// and the antenna), the runs (stat bonuses and pay) and the collection (disintegration and fusion). No imports from
// those services, so each can read it.

export async function labLevels(db: Kysely<DB>, accountId: string): Promise<Record<string, number>> {
  const rows = await db.selectFrom('galaxy.lab_nodes').select(['node', 'level']).where('account_id', '=', accountId).execute();
  return Object.fromEntries(rows.map((r) => [r.node, r.level]));
}

export async function accountLabEffects(db: Kysely<DB>, accountId: string, cfg: LabConfig): Promise<LabEffects> {
  return labEffects(await labLevels(db, accountId), cfg);
}
