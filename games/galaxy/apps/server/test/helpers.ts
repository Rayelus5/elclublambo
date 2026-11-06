import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { buildApp } from '../src/app';
import { createDb } from '../src/db';
import type { DB } from '../src/db/schema';
import type { Env } from '../src/env';

/** Local (or CI) Postgres as galaxy_api; scripts/dev-db-role.mjs sets the dev password. */
export const TEST_DATABASE_URL =
  process.env.GALAXY_TEST_DATABASE_URL ?? 'postgresql://galaxy_api:galaxy_dev@127.0.0.1:54322/postgres';

/** Fixed 32-byte test key (never used outside tests). */
export const TEST_TOTP_KEY = Buffer.alloc(32, 7);

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    DATABASE_URL: TEST_DATABASE_URL,
    GALAXY_PUBLIC_ORIGINS: ['http://localhost:5173', 'http://localhost:8080'],
    GALAXY_TOTP_KEY: TEST_TOTP_KEY,
    PORT: 8080,
    WEB_DIST: '/nonexistent-web-dist',
    TRUST_CF_IP: true,
    ...overrides,
  };
}

/** Unique, valid username (at most 20 chars) so tests never collide in the shared local DB. */
export function uniqueName(prefix: string): string {
  return `${prefix.slice(0, 11)}_${randomBytes(4).toString('hex')}`;
}

export const ORIGIN = 'http://localhost:5173';

export async function testApp(
  opts: { env?: Partial<Env>; beforeReady?: (app: FastifyInstance) => void } = {},
): Promise<{ app: FastifyInstance; db: Kysely<DB>; close: () => Promise<void> }> {
  const env = testEnv(opts.env);
  const db = createDb(env.DATABASE_URL);
  const app = await buildApp({ env, db });
  opts.beforeReady?.(app);
  await app.ready();
  return {
    app,
    db,
    close: async () => {
      await app.close();
      await db.destroy();
    },
  };
}
