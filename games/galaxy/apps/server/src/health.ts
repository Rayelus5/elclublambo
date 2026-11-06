import type { FastifyInstance } from 'fastify';
import { type Kysely, sql } from 'kysely';
import type { DB } from './db/schema';

/** GET /galaxy/api/health: 200 { ok, db: 'up' } when Postgres answers, 503 { ok: false, db: 'down' } otherwise. */
export function registerHealth(app: FastifyInstance, db: Kysely<DB>): void {
  app.get('/galaxy/api/health', async (_req, reply) => {
    try {
      await sql`select 1`.execute(db);
      return { ok: true, db: 'up' };
    } catch {
      return reply.code(503).send({ ok: false, db: 'down' });
    }
  });
}
