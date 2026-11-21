import { currentSeason, type LiveEvent } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { closeEndedSeasons, type SeasonStore } from './records';

// The seasons' job (plan «temporadas como fichas», PR 2): every minute a season that ended is archived with its own
// prizes (whether anyone reads it or not), and a season that has just started is announced once to everyone online.
// `announced_at` keeps the once across restarts; a season that started more than a day before it is noticed (the first
// deploy, a long outage) is marked without a word. Only the production entry starts it, never the tests.

const EVERY_MS = 60_000;
const ANNOUNCE_WITHIN_MS = 86_400_000;

export interface SeasonJobDeps {
  db: Kysely<DB>;
  config: ConfigReader;
  store: SeasonStore;
  now: () => Date;
  live: { onlineIds(): Iterable<string>; sendMany(ids: Iterable<string>, event: LiveEvent): void };
}

/** One pass: closes what ended, announces what started. Returns what it did (for the log and the tests). */
export async function seasonTick(deps: SeasonJobDeps): Promise<{ announced: string | null }> {
  const now = deps.now();
  await closeEndedSeasons(deps.db, deps.store, (await deps.config.get('account')).minRunSeconds, now);
  const open = currentSeason(await deps.store.list(), now.getTime());
  if (!open || open.announcedAt) return { announced: null };
  const won = await deps.db.updateTable('galaxy.seasons').set({ announced_at: now }).where('id', '=', open.id).where('announced_at', 'is', null).returning('id').executeTakeFirst();
  deps.store.invalidate();
  if (!won || now.getTime() - Date.parse(open.startsAt) > ANNOUNCE_WITHIN_MS) return { announced: null };
  deps.live.sendMany(deps.live.onlineIds(), { type: 'notice', notice: { kind: 'season', event: 'started', id: open.id, name: open.name } });
  return { announced: open.id };
}

/** Runs the pass 15 seconds after the start and then every minute; returns the stop. */
export function startSeasonJobs(deps: SeasonJobDeps, log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const { announced } = await seasonTick(deps);
      if (announced) log.info({ season: announced }, 'season announced');
    } catch (err) {
      log.error({ err: { name: (err as Error).name, code: (err as { code?: unknown }).code } }, 'season job failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), 15_000);
  const every = setInterval(() => void run(), EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
