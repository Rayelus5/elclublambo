import { type Kysely, sql } from 'kysely';
import type { DB } from './db/schema';

export class RateLimitedError extends Error {
  constructor() {
    super('rate_limited');
    this.name = 'RateLimitedError';
  }
}

/** One hit on a fixed-window counter (galaxy.rate_limit). Throws RateLimitedError past `max` hits per window. */
export async function hitRateLimit(
  db: Kysely<DB>,
  subject: string,
  bucket: string,
  max: number,
  windowSeconds: number,
): Promise<void> {
  try {
    await sql`select galaxy.rate_limit(${subject}, ${bucket}, ${max}::int, make_interval(secs => ${windowSeconds}))`.execute(
      db,
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'rate_limited') throw new RateLimitedError();
    throw err;
  }
}
