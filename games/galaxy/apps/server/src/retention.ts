import { type Kysely, sql } from 'kysely';
import type { DB } from './db/schema';

// Retention (GDD §18; M8b): every hour the database deletes what has expired (galaxy.prune_retention: ordinary runs'
// recorded inputs after 30 days, unreported chat after 90). Only the production entry starts it, never the tests.

const HOUR_MS = 3_600_000;

export async function pruneOnce(db: Kysely<DB>): Promise<{ inputs: number; chat: number }> {
  const { rows } = await sql<{ r: { inputs: number; chat: number } }>`select galaxy.prune_retention() as r`.execute(db);
  return rows[0]!.r;
}

/** Runs the retention a minute after the start and then every hour; returns the stop. */
export function startRetention(db: Kysely<DB>, log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }): () => void {
  const run = () =>
    pruneOnce(db).then(
      (r) => {
        if (r.inputs > 0 || r.chat > 0) log.info(r, 'retention pruned');
      },
      (err: unknown) => log.error({ err }, 'retention failed'),
    );
  const first = setTimeout(run, 60_000);
  const every = setInterval(run, HOUR_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
