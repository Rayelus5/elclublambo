import { type LabNode, type LabNodeView, labEffects, labNodeStatus, type LabView, nodeNextGain, nodeTotal } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';
import { debit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import type { RunsDeps } from '../runs/hangar';
import { lockStation, settleStation } from '../station/service';
import { labLevels, labSeasonId, seasonLabLevels } from './levels';

// The Laboratorio on the server (GDD §10.6, M4b-2). Closed until its room is repaired; a node level is bought with
// star dust and components under the station's lock (its effects reach the refinery and the antenna), naming the level
// it buys: a stale view gets 409 lab_changed and pays nothing. A station-branch node first settles the refinery at the
// old rate, so what was refined before stays.
// The seasonal core (shop and lab plan, F2a) is a second tree whose levels are kept by season id: shown and sold only
// while a season is open. Buying one of its levels names the season too, so a view of another season gets 409
// lab_season_changed (and between seasons, lab_season_closed). It never touches the station's machines.

type Db = Kysely<DB>;

async function labOpen(db: Db, accountId: string): Promise<boolean> {
  const row = await db.selectFrom('galaxy.station_rooms').select('level').where('account_id', '=', accountId).where('room', '=', 'lab').executeTakeFirst();
  return (row?.level ?? 0) >= 1;
}

/** A node as the UI shows it: its state in its own tree and what it gives (the server does the maths). */
function nodeView(n: LabNode, levels: Record<string, number>, tree: readonly LabNode[]): LabNodeView {
  const status = labNodeStatus(n, levels, tree);
  return {
    id: n.id,
    branch: n.branch,
    name: n.name,
    effect: n.effect,
    per: n.per,
    requires: n.requires,
    ...status,
    now: nodeTotal(n, status.level),
    nextGain: nodeNextGain(n, status.level),
    at: n.at,
  };
}

export async function labView(deps: RunsDeps, accountId: string, db: Db = deps.db): Promise<LabView> {
  const [cfg, season] = await Promise.all([deps.config.get('lab'), deps.config.get('season')]);
  const seasonId = labSeasonId(cfg, season, deps.now());
  const [levels, seasonLevels] = await Promise.all([labLevels(db, accountId), seasonId ? seasonLabLevels(db, accountId, seasonId) : null]);
  return {
    open: await labOpen(db, accountId),
    nodes: cfg.nodes.map((n) => nodeView(n, levels, cfg.nodes)),
    season:
      seasonId && seasonLevels
        ? { id: seasonId, name: season.name, endsAt: season.endsAt, nodes: cfg.season.map((n) => nodeView(n, seasonLevels, cfg.season)) }
        : null,
    effects: labEffects(levels, cfg, seasonLevels),
    wallet: await getWallet(db, accountId),
  };
}

/**
 * Buys a node's next level. `season` names the season of a seasonal node (the view's): checked against the open one
 * before anything is paid.
 */
export async function upgradeLabNode(
  deps: RunsDeps,
  trx: Db,
  accountId: string,
  nodeId: string,
  level: number,
  key: string,
  season?: string,
): Promise<LabView> {
  const [cfg, seasonCfg] = await Promise.all([deps.config.get('lab'), deps.config.get('season')]);
  const seasonal = cfg.season.find((n) => n.id === nodeId);
  const node = seasonal ?? cfg.nodes.find((n) => n.id === nodeId);
  if (!node || (!seasonal && season !== undefined)) throw new HttpError(400, 'invalid_input');
  const seasonId = seasonal ? labSeasonId(cfg, seasonCfg, deps.now()) : null;
  if (seasonal && seasonId === null) throw new HttpError(409, 'lab_season_closed');
  if (seasonal && season !== seasonId) throw new HttpError(409, 'lab_season_changed');
  await lockStation(trx, accountId);
  if (!(await labOpen(trx, accountId))) throw new HttpError(409, 'lab_closed');
  const levels = seasonId ? await seasonLabLevels(trx, accountId, seasonId) : await labLevels(trx, accountId);
  const status = labNodeStatus(node, levels, seasonal ? cfg.season : cfg.nodes);
  if (!status.unlocked) throw new HttpError(409, 'lab_locked');
  if (!status.next) throw new HttpError(409, 'lab_maxed');
  if (level !== status.level + 1) throw new HttpError(409, 'lab_changed');
  if (node.effect.kind === 'refinery' || node.effect.kind === 'antenna') await settleStation(deps, trx, accountId);
  const ref = seasonId ? { node: node.id, level, season: seasonId } : { node: node.id, level };
  // Components before dust: every multi-currency debit takes its balance rows in the same order (no deadlocks).
  if (status.next.components > 0) await debit(trx, accountId, 'components', status.next.components, 'lab', ref, key);
  if (status.next.dust > 0) await debit(trx, accountId, 'dust', status.next.dust, 'lab', ref, key);
  const now = deps.now();
  if (seasonId) {
    await trx
      .insertInto('galaxy.lab_season_nodes')
      .values({ account_id: accountId, season: seasonId, node: node.id, level, updated_at: now })
      .onConflict((oc) => oc.columns(['account_id', 'season', 'node']).doUpdateSet({ level, updated_at: now }))
      .execute();
  } else {
    await trx
      .insertInto('galaxy.lab_nodes')
      .values({ account_id: accountId, node: node.id, level, updated_at: now })
      .onConflict((oc) => oc.columns(['account_id', 'node']).doUpdateSet({ level, updated_at: now }))
      .execute();
  }
  return labView(deps, accountId, trx);
}
