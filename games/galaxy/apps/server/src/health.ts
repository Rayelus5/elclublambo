import type { FastifyInstance } from 'fastify';
import { type Kysely, sql } from 'kysely';
import type { DB } from './db/schema';

/**
 * GET /galaxy/api/ping (2026-11-17): 204 and nothing else, for the lobby to show the game server's ping («España 28
 * ms»). Registered on the root app, outside the API plugin, so no session, maintenance or database hook runs before it:
 * it measures the network path the game's sockets take, not Postgres.
 */
export function registerPing(app: FastifyInstance): void {
  app.get('/galaxy/api/ping', { logLevel: 'silent' }, async (_req, reply) => reply.header('cache-control', 'no-store').code(204).send());
}

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
