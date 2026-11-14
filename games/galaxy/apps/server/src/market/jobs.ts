import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { refreshMarketStats } from './service';

// The market's job (the owner, 2026-11-14: a market «para 100.000 anuncios»): every few minutes it marks the listings
// whose time ran out as expired (500 at a time, skipping any a sale holds: the reads already leave them out, this keeps
// the listings on sale small) and keeps the public numbers fresh. Only the production entry starts it, never the tests.

const EVERY_MS = 5 * 60_000;
const BATCH = 500;

/** Marks up to `batch` listings past their time as expired; how many. */
export async function expireListings(db: Kysely<DB>, batch = BATCH): Promise<number> {
  const { rows } = await sql<{ id: string }>`
    update galaxy.market_listings set status = 'expired'
     where id in (
       select id from galaxy.market_listings
        where status = 'active' and expires_at <= now()
        order by expires_at
        limit ${batch}
        for update skip locked)
    returning id`.execute(db);
  return rows.length;
}

/** Runs the job half a minute after the start and then every 5 minutes; returns the stop. */
export function startMarketJobs(db: Kysely<DB>, log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }): () => void {
  const run = async () => {
    try {
      let expired = 0;
      for (let n = BATCH; n === BATCH; ) {
        n = await expireListings(db);
        expired += n;
      }
      if (expired > 0) log.info({ expired }, 'market listings expired');
      await refreshMarketStats(db, new Date());
    } catch (err) {
      log.error({ err }, 'market job failed');
    }
  };
  const first = setTimeout(() => void run(), 30_000);
  const every = setInterval(() => void run(), EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
