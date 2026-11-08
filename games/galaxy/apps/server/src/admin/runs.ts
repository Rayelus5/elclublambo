import { ADMIN_RUNS_PAGE, type AdminRunList, type AdminRunMark, type AdminRunReplay, type AdminRunRow, parseConfig } from '@galaxy/shared';
import type { RelicInput, StatBonus } from '@galaxy/sim';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { SessionInfo } from '../auth/sessions';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { invalidateLeaderboard } from '../social/leaderboard';
import { guardTarget } from './players';

// The panel's runs (GDD §16.2, §16.6; M6d-3): every run, newest first; a run's replay rebuilt from what the server kept
// at its start (seed, relics, the level and Laboratorio snapshot) with the content of the version it started with; and
// marking it as suspicious or not, audited. A mark changes what reads `suspicious` (ranking, unlocks, profiles); the
// experience and pay a run already gave stay.

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

type RunListRow = {
  id: string;
  player: string;
  started_at: Date;
  sector: string;
  probe: string;
  outcome: string | null;
  seconds: number | null;
  depth: number | null;
  kills: number | null;
  suspicious: boolean;
  flags: string[];
};

function rowOf(r: RunListRow): AdminRunRow {
  return {
    id: r.id,
    player: r.player,
    startedAt: iso(r.started_at)!,
    sector: r.sector,
    probe: r.probe,
    outcome: (r.outcome as AdminRunRow['outcome']) ?? null,
    seconds: r.seconds ?? null,
    depth: r.depth ?? null,
    kills: r.kills ?? null,
    suspicious: r.suspicious,
    flags: r.flags,
  };
}

function base(db: Kysely<DB>) {
  return db.selectFrom('galaxy.runs as r').innerJoin('galaxy.accounts as a', 'a.id', 'r.account_id');
}

/** A page of runs, newest first, by player (exact name, any case) and by whether they are suspicious. */
export async function listRuns(db: Kysely<DB>, q: { page: number; player?: string; suspicious?: 'true' | 'false' }): Promise<AdminRunList> {
  let query = base(db);
  if (q.player) query = query.where(sql<string>`lower(a.username)`, '=', q.player.toLowerCase());
  if (q.suspicious) query = query.where('r.suspicious', '=', q.suspicious === 'true');
  const [{ total }, rows] = await Promise.all([
    query.select(sql<number>`count(*)::int`.as('total')).executeTakeFirstOrThrow(),
    query
      .select(['r.id', 'a.username as player', 'r.started_at', 'r.sector', 'r.probe', 'r.outcome', 'r.seconds', 'r.depth', 'r.kills', 'r.suspicious', 'r.flags'])
      .orderBy('r.started_at', 'desc')
      .orderBy('r.id', 'desc')
      .limit(ADMIN_RUNS_PAGE)
      .offset((q.page - 1) * ADMIN_RUNS_PAGE)
      .execute(),
  ]);
  return { runs: rows.map(rowOf), total, page: q.page, pages: Math.max(1, Math.ceil(total / ADMIN_RUNS_PAGE)) };
}

/** Everything to replay a run: its start as kept, the content of its own version (0 or gone: the defaults) and its log. */
export async function runReplay(db: Kysely<DB>, id: string): Promise<AdminRunReplay> {
  const r = await base(db)
    .leftJoin('galaxy.run_inputs as i', 'i.run_id', 'r.id')
    .select([
      'r.id',
      'a.username as player',
      'r.started_at',
      'r.finished_at',
      'r.sector',
      'r.probe',
      'r.outcome',
      'r.seconds',
      'r.depth',
      'r.kills',
      'r.suspicious',
      'r.flags',
      'r.ticks',
      'r.level',
      'r.boss_kills',
      'r.hash',
      'r.sim_version',
      'r.content_version',
      'r.seed',
      'r.relics',
      'r.upgrades',
      'i.inputs',
    ])
    .where('r.id', '=', id)
    .executeTakeFirst();
  if (!r) throw new HttpError(404, 'run_not_found');
  const stored = r.content_version > 0
    ? await db.selectFrom('galaxy.game_config_versions').select('data').where('key', '=', 'content').where('version', '=', r.content_version).executeTakeFirst()
    : undefined;
  const upgrades = (r.upgrades ?? {}) as { bonuses?: StatBonus[]; variant?: string | null };
  return {
    run: {
      ...rowOf(r),
      finishedAt: iso(r.finished_at),
      ticks: r.ticks ?? null,
      level: r.level ?? null,
      bossKills: r.boss_kills ?? null,
      hash: r.hash ?? null,
      simVersion: r.sim_version,
      contentVersion: r.content_version,
    },
    start: {
      seed: String(r.seed),
      sector: r.sector,
      probe: r.probe,
      relics: r.relics as RelicInput[],
      bonuses: Array.isArray(upgrades.bonuses) ? upgrades.bonuses : [],
      variant: typeof upgrades.variant === 'string' ? upgrades.variant : null,
      content: parseConfig('content', stored?.data ?? {}),
    },
    inputs: r.inputs ? Buffer.from(r.inputs).toString('base64') : null,
  };
}

/**
 * Marks a finished run as suspicious (adding the `admin` flag) or takes the mark off (removing it; the checks' own flags
 * stay as the record of what they saw). The same state again changes and audits nothing.
 */
export async function markRun(db: Kysely<DB>, actor: AuditActor, s: SessionInfo, id: string, req: AdminRunMark): Promise<{ suspicious: boolean; flags: string[] }> {
  const out = await inTransaction(db, async (trx) => {
    const run = await trx
      .selectFrom('galaxy.runs as r')
      .innerJoin('galaxy.accounts as a', 'a.id', 'r.account_id')
      .select(['r.id', 'a.username', 'r.finished_at', 'r.suspicious', 'r.flags'])
      .where('r.id', '=', id)
      .forUpdate('r')
      .executeTakeFirst();
    if (!run) throw new HttpError(404, 'run_not_found');
    await guardTarget(trx, s, run.username, { self: false });
    if (!run.finished_at) throw new HttpError(409, 'run_open');
    const before = { suspicious: run.suspicious, flags: run.flags };
    if (run.suspicious === req.suspicious) return { state: before, changed: false };
    const flags = req.suspicious ? [...run.flags.filter((f) => f !== 'admin'), 'admin'] : run.flags.filter((f) => f !== 'admin');
    await trx.updateTable('galaxy.runs').set({ suspicious: req.suspicious, flags }).where('id', '=', id).execute();
    const after = { suspicious: req.suspicious, flags };
    await writeAudit(trx, { actor, action: req.suspicious ? 'run.mark' : 'run.unmark', targetType: 'run', targetId: id, before, after, reason: req.reason });
    return { state: after, changed: true };
  });
  if (out.changed) invalidateLeaderboard();
  return out.state;
}
