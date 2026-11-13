import { randomBytes } from 'node:crypto';
import { type ConfigKey, type LiveEvent, type LiveNotice, parseConfig, type Role } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { Secret, TOTP } from 'otpauth';
import { buildApp } from '../src/app';
import { runCli } from '../src/cli';
import { type ConfigService, createConfigService } from '../src/config/service';
import { createDb } from '../src/db';
import type { DB } from '../src/db/schema';
import type { Env } from '../src/env';
import type { ShopGateway } from '../src/shop/gateway';

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
    stripe: null,
    stripeIssue: null,
    ...overrides,
  };
}

/** Unique, valid username (at most 20 chars) so tests never collide in the shared local DB. */
export function uniqueName(prefix: string): string {
  return `${prefix.slice(0, 11)}_${randomBytes(4).toString('hex')}`;
}

export const ORIGIN = 'http://localhost:5173';

/**
 * A random address per test: rate-limit counters live in the shared DB with 10 min / 1 h windows, so tests that
 * reused 127.0.0.1 would trip each other across runs.
 */
export function randomIp(): string {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

type InjectOpts = { cookie?: string; ip?: string; origin?: string | null; headers?: Record<string, string> };

function headers(opts: InjectOpts): Record<string, string> {
  const h: Record<string, string> = { 'cf-connecting-ip': opts.ip ?? randomIp() };
  if (opts.origin !== null) h.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) h.cookie = `gs_sid=${opts.cookie}`;
  return { ...h, ...opts.headers };
}

export function post(app: FastifyInstance, url: string, body?: unknown, opts: InjectOpts = {}) {
  return app.inject({ method: 'POST', url, payload: body as object | undefined, headers: headers(opts) });
}

export function put(app: FastifyInstance, url: string, body?: unknown, opts: InjectOpts = {}) {
  return app.inject({ method: 'PUT', url, payload: body as object | undefined, headers: headers(opts) });
}

export function get(app: FastifyInstance, url: string, opts: InjectOpts = {}) {
  return app.inject({ method: 'GET', url, headers: headers(opts) });
}

/** Current TOTP code for a base32 secret (SHA1, 6 digits, 30 s), computed independently with otpauth. */
export function totpNow(base32: string, at: Date = new Date()): string {
  return TOTP.generate({ secret: Secret.fromBase32(base32), algorithm: 'SHA1', digits: 6, period: 30, timestamp: at.getTime() });
}

/** Creates a committed admin account through the real CLI (`--json`) and returns its one-time credentials. */
export async function createAdminViaCli(
  db: Kysely<DB>,
  role: Role,
): Promise<{ username: string; password: string; totpSecret: string; totpUri: string }> {
  const lines: string[] = [];
  const code = await runCli(['create-admin', uniqueName('adm'), '--role', role, '--json'], {
    db,
    env: testEnv(),
    out: (s) => lines.push(s),
  });
  if (code !== 0) throw new Error(`create-admin failed: ${lines.join('\n')}`);
  return JSON.parse(lines.join('\n'));
}

/** Value of the gs_sid cookie set by a response (throws if absent). */
export function sessionCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const c = res.cookies.find((k) => k.name === 'gs_sid');
  if (!c) throw new Error('no gs_sid cookie');
  return c.value;
}

export async function testApp(
  opts: {
    env?: Partial<Env>;
    beforeReady?: (app: FastifyInstance) => void;
    now?: () => Date;
    config?: ConfigService;
    /** A small pool (and a short wait for a connection) to catch code that needs two at once. */
    pool?: { max: number; timeoutMs: number };
    /** Live config cache lifetime; 0 reads the database every time. */
    configTtlMs?: number;
    /** The shop's payment gateway (test/fake-gateway.ts); none by default (a closed shop). */
    shopGateway?: ShopGateway | null;
    /** The server's disk for «Almacenamiento»; the real one by default. */
    disk?: () => Promise<{ totalBytes: number; freeBytes: number } | null>;
  } = {},
): Promise<{ app: FastifyInstance; db: Kysely<DB>; close: () => Promise<void> }> {
  const env = testEnv(opts.env);
  const db = createDb(env.DATABASE_URL, opts.pool ? { max: opts.pool.max, connectionTimeoutMillis: opts.pool.timeoutMs } : {});
  const config = opts.config ?? (opts.configTtlMs === undefined ? undefined : createConfigService(db, { ttlMs: opts.configTtlMs }));
  const app = await buildApp({ env, db, now: opts.now, config, shopGateway: opts.shopGateway ?? null, disk: opts.disk });
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

/**
 * A ConfigService that serves fixed values (schema defaults merged with `overrides`) without touching the shared DB,
 * so a test can close a banner or switch the gacha off without affecting other tests.
 */
export function fixedConfig(overrides: Partial<Record<ConfigKey, unknown>>): ConfigService {
  return {
    get: async (key) => parseConfig(key, overrides[key] ?? {}),
    getVersioned: async (key) => ({ value: parseConfig(key, overrides[key] ?? {}), version: 0 }),
    versions: async () => [],
    active: async () => [],
    publish: async () => ({ version: 0 }),
    publishMany: async () => ({ versions: {} }),
  } as ConfigService;
}

/**
 * A live socket as the browser opens it (real-time notices plan), with every event it receives and the notices among
 * them. Close it with `ws.terminate()` at the end of the test.
 */
export async function openLive(app: FastifyInstance, cookie: string) {
  const events: LiveEvent[] = [];
  const ws = await app.injectWS('/galaxy/api/live/ws', { headers: { origin: ORIGIN, cookie: `gs_sid=${cookie}` } });
  ws.on('message', (data) => events.push(JSON.parse(String(data)) as LiveEvent));
  return { ws, events, notices: (): LiveNotice[] => events.flatMap((e) => (e.type === 'notice' ? [e.notice] : [])) };
}

/** Lets what the server pushes arrive. */
export const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
