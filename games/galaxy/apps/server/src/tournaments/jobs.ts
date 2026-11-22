import { SIM_VERSION } from '@galaxy/sim';
import { sql } from 'kysely';
import type { TournamentDeps } from './admin';
import { tournamentsIn } from './records';
import type { Replayer } from './replayer';
import { finishTournament, processChecks, queueChecks } from './review';
import { invalidateTournament } from './scoring';

// The tournaments' job (plan «temporadas como fichas», part 5; GDD §13.3), every minute like the seasons': a scheduled
// tournament whose start came starts (with the simulation version it starts with; its entrants hear it), a running one
// whose end came goes to review (its ranking stops moving and its prize places' solo runs are queued), the queue is
// replayed one run at a time (in a worker thread in production), and a reviewed one publishes once its hours are over
// with nothing pending. Each step is a guarded state change, so a restart or a second pass does nothing twice; one
// tournament that fails is logged and the others go on. Only the production entry starts it.

const EVERY_MS = 60_000;
/** A start or end noticed this late (the first deploy, a long outage) is not announced. */
const NOTICE_WITHIN_MS = 86_400_000;
/** At most this long replaying per pass (the next pass goes on). */
const REPLAY_BUDGET_MS = 45_000;

type Log = { info: (o: object, m: string) => void; error: (o: object, m: string) => void };

export interface TournamentJobDeps extends TournamentDeps {
  replayer: Replayer;
  log?: Log;
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

const errOf = (err: unknown) => ({ name: (err as Error).name, code: (err as { code?: unknown }).code });

/** One pass. Returns what it did (for the log and the tests). */
export async function tournamentTick(deps: TournamentJobDeps): Promise<TournamentTick> {
  const now = deps.now();
  const out: TournamentTick = { started: [], ended: [], checked: 0, finished: [] };
  /** One tournament's step: a failure is logged, the others go on. */
  const each = async (id: string, step: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      deps.log?.error({ tournament: id, step, err: errOf(err) }, 'tournament step failed');
    }
  };

  // Starts: the state changes once (whoever flips it tells the entrants).
  const started = await deps.db
    .updateTable('galaxy.tournaments')
    .set({ state: 'running', started_sim_version: SIM_VERSION, version: sql`version + 1`, updated_at: sql`now()` })
    .where('state', '=', 'scheduled')
    .where('starts_at', '<=', now)
    .returning(['id', 'slug', 'title', 'starts_at'])
    .execute();
  for (const t of started) {
    out.started.push(t.id);
    invalidateTournament(t.id);
    if (now.getTime() - t.starts_at.getTime() > NOTICE_WITHIN_MS) continue;
    await each(t.id, 'started', async () => deps.live?.sendMany(await liveEntrants(deps, t.id), { type: 'notice', notice: { kind: 'tournament', event: 'started', id: t.id, slug: t.slug, title: t.title } }));
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
    if (now.getTime() - t.ends_at.getTime() > NOTICE_WITHIN_MS) continue;
    await each(t.id, 'ended', async () => deps.live?.sendMany(await liveEntrants(deps, t.id), { type: 'notice', notice: { kind: 'tournament', event: 'ended', id: t.id, slug: t.slug, title: t.title } }));
  }
  // Those that just ended are queued now, so this pass starts replaying; for the rest, finishTournament queues any prize
  // place's run still missing (a pass cut short by a restart) before it would publish.
  const reviewed = await tournamentsIn(deps.db, ['review'], (id, err) => deps.log?.error({ tournament: id, err: errOf(err) }, 'tournament_invalid_stored_row'));
  for (const t of reviewed) {
    if (out.ended.includes(t.id)) await each(t.id, 'queue', async () => void (await queueChecks(deps, t)));
  }

  try {
    out.checked = await processChecks(deps, deps.replayer, REPLAY_BUDGET_MS);
  } catch (err) {
    deps.log?.error({ step: 'replay', err: errOf(err) }, 'tournament step failed');
  }

  for (const t of reviewed) {
    await each(t.id, 'publish', async () => {
      if (await finishTournament(deps, t.id)) out.finished.push(t.id);
    });
  }
  return out;
}

/**
 * Runs the pass 20 seconds after the start and then every minute; returns the stop, which closes the replayer (what is
 * being replayed is aborted and stays pending for the next process) and waits for the pass in progress to end.
 */
export function startTournamentJobs(deps: TournamentJobDeps, log: Log): () => Promise<void> {
  let current: Promise<void> | null = null;
  let stopped = false;
  const run = () => {
    if (current || stopped) return;
    current = (async () => {
      try {
        const r = await tournamentTick({ ...deps, log });
        if (r.started.length + r.ended.length + r.checked + r.finished.length > 0) log.info(r, 'tournaments');
      } catch (err) {
        log.error({ err: errOf(err) }, 'tournament job failed');
      } finally {
        current = null;
      }
    })();
  };
  const first = setTimeout(run, 20_000);
  const every = setInterval(run, EVERY_MS);
  return async () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(every);
    await deps.replayer.close();
    await current;
  };
}
