import { sql } from 'kysely';
import type { TournamentDeps } from './admin';
import { tournamentsIn } from './records';
import type { Replayer } from './replayer';
import { finishTournament, processChecks, queueChecks } from './review';
import { invalidateTournament } from './scoring';

// The tournaments' job (plan «temporadas como fichas», part 5; GDD §13.3), every minute like the seasons': a scheduled
// tournament whose start came starts (its entrants hear it), a running one whose end came goes to review (its ranking
// stops moving and its prize places' solo runs are queued), the queue is replayed one run at a time (in a worker thread
// in production), and a reviewed one publishes once its hours are over with nothing pending. Each step is a guarded
// state change, so a restart or a second pass does nothing twice. Only the production entry starts it.

const EVERY_MS = 60_000;
/** A start or end noticed this late (the first deploy, a long outage) is not announced. */
const NOTICE_WITHIN_MS = 86_400_000;
/** At most this long replaying per pass (the next pass goes on). */
const REPLAY_BUDGET_MS = 45_000;

export interface TournamentJobDeps extends TournamentDeps {
  replayer: Replayer;
}

export interface TournamentTick {
  started: string[];
  ended: string[];
  checked: number;
  finished: string[];
}

async function liveEntrants(deps: TournamentDeps, id: string): Promise<string[]> {
  const rows = await deps.db.selectFrom('galaxy.tournament_entries').select('account_id').where('tournament_id', '=', id).where('left_at', 'is', null).where('disqualified', '=', false).execute();
  return rows.map((r) => r.account_id);
}

/** One pass. Returns what it did (for the log and the tests). */
export async function tournamentTick(deps: TournamentJobDeps): Promise<TournamentTick> {
  const now = deps.now();
  const out: TournamentTick = { started: [], ended: [], checked: 0, finished: [] };

  // Starts: the state changes once (whoever flips it tells the entrants).
  const started = await deps.db
    .updateTable('galaxy.tournaments')
    .set({ state: 'running', version: sql`version + 1`, updated_at: sql`now()` })
    .where('state', '=', 'scheduled')
    .where('starts_at', '<=', now)
    .returning(['id', 'slug', 'title', 'starts_at'])
    .execute();
  for (const t of started) {
    out.started.push(t.id);
    invalidateTournament(t.id);
    if (now.getTime() - t.starts_at.getTime() <= NOTICE_WITHIN_MS) deps.live?.sendMany(await liveEntrants(deps, t.id), { type: 'notice', notice: { kind: 'tournament', event: 'started', id: t.id, slug: t.slug, title: t.title } });
  }

  // Ends: no more sign-ups nor departures, nothing after the end counts, and the review's queue is filled.
  const ended = await deps.db
    .updateTable('galaxy.tournaments')
    .set({ state: 'review', version: sql`version + 1`, updated_at: sql`now()` })
    .where('state', '=', 'running')
    .where('ends_at', '<=', now)
    .returning(['id', 'slug', 'title', 'ends_at'])
    .execute();
  for (const t of ended) {
    out.ended.push(t.id);
    invalidateTournament(t.id);
    if (now.getTime() - t.ends_at.getTime() <= NOTICE_WITHIN_MS) deps.live?.sendMany(await liveEntrants(deps, t.id), { type: 'notice', notice: { kind: 'tournament', event: 'ended', id: t.id, slug: t.slug, title: t.title } });
  }
  // Those that just ended are queued now, so this pass starts replaying; for the rest, finishTournament queues any prize
  // place's run still missing (a pass cut short by a restart) before it would publish.
  const reviewed = await tournamentsIn(deps.db, ['review']);
  for (const t of reviewed) if (out.ended.includes(t.id)) await queueChecks(deps, t);

  out.checked = await processChecks(deps, deps.replayer, REPLAY_BUDGET_MS);

  for (const t of reviewed) if (await finishTournament(deps, t.id)) out.finished.push(t.id);
  return out;
}

/** Runs the pass 20 seconds after the start and then every minute; returns the stop (which also stops the replayer). */
export function startTournamentJobs(deps: TournamentJobDeps, log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }): () => Promise<void> {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await tournamentTick(deps);
      if (r.started.length + r.ended.length + r.checked + r.finished.length > 0) log.info(r, 'tournaments');
    } catch (err) {
      log.error({ err: { name: (err as Error).name, code: (err as { code?: unknown }).code } }, 'tournament job failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), 20_000);
  const every = setInterval(() => void run(), EVERY_MS);
  return async () => {
    clearTimeout(first);
    clearInterval(every);
    await deps.replayer.close();
  };
}
