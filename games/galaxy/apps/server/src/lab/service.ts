import { labEffects, labNodeStatus, type LabView } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';
import { debit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import type { RunsDeps } from '../runs/hangar';
import { lockStation, settleStation } from '../station/service';
import { labLevels } from './levels';

// The Laboratorio on the server (GDD §10.6, M4b-2). Closed until its room is repaired; a node level is bought with
// star dust and components under the station's lock (its effects reach the refinery and the antenna), naming the level
// it buys: a stale view gets 409 lab_changed and pays nothing. A station-branch node first settles the refinery at the
// old rate, so what was refined before stays.

type Db = Kysely<DB>;

async function labOpen(db: Db, accountId: string): Promise<boolean> {
  const row = await db.selectFrom('galaxy.station_rooms').select('level').where('account_id', '=', accountId).where('room', '=', 'lab').executeTakeFirst();
  return (row?.level ?? 0) >= 1;
}

export async function labView(deps: RunsDeps, accountId: string, db: Db = deps.db): Promise<LabView> {
  const cfg = await deps.config.get('lab');
  const levels = await labLevels(db, accountId);
  return {
    open: await labOpen(db, accountId),
    nodes: cfg.nodes.map((n) => ({ id: n.id, branch: n.branch, name: n.name, effect: n.effect, per: n.per, requires: n.requires, ...labNodeStatus(n, levels, cfg) })),
    effects: labEffects(levels, cfg),
    wallet: await getWallet(db, accountId),
  };
}

export async function upgradeLabNode(deps: RunsDeps, trx: Db, accountId: string, nodeId: string, level: number, key: string): Promise<LabView> {
  const cfg = await deps.config.get('lab');
  const node = cfg.nodes.find((n) => n.id === nodeId);
  if (!node) throw new HttpError(400, 'invalid_input');
  await lockStation(trx, accountId);
  if (!(await labOpen(trx, accountId))) throw new HttpError(409, 'lab_closed');
  const status = labNodeStatus(node, await labLevels(trx, accountId), cfg);
  if (!status.unlocked) throw new HttpError(409, 'lab_locked');
  if (!status.next) throw new HttpError(409, 'lab_maxed');
  if (level !== status.level + 1) throw new HttpError(409, 'lab_changed');
  if (node.effect.kind === 'refinery' || node.effect.kind === 'antenna') await settleStation(deps, trx, accountId);
  const ref = { node: node.id, level };
  // Components before dust: every multi-currency debit takes its balance rows in the same order (no deadlocks).
  if (status.next.components > 0) await debit(trx, accountId, 'components', status.next.components, 'lab', ref, key);
  if (status.next.dust > 0) await debit(trx, accountId, 'dust', status.next.dust, 'lab', ref, key);
  const now = deps.now();
  await trx
    .insertInto('galaxy.lab_nodes')
    .values({ account_id: accountId, node: node.id, level, updated_at: now })
    .onConflict((oc) => oc.columns(['account_id', 'node']).doUpdateSet({ level, updated_at: now }))
    .execute();
  return labView(deps, accountId, trx);
}
