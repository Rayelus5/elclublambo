import { afterAll, beforeAll, expect, test } from 'vitest';
import { buildApp } from '../../src/app';
import { createDb } from '../../src/db';
import { CSP } from '../../src/security/headers';
import { ORIGIN, testApp, testEnv } from '../helpers';

let ctx: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  ctx = await testApp({
    beforeReady: (app) => {
      app.post('/galaxy/api/_test', async () => ({ ok: true }));
    },
  });
});
afterAll(() => ctx.close());

test('health responde ok con BD y lleva las cabeceras', async () => {
  const res = await ctx.app.inject({ method: 'GET', url: '/galaxy/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true, db: 'up' });
  expect(res.headers['content-security-policy']).toBe(CSP);
  expect(res.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
});

test('health → 503 db down si la BD no responde', async () => {
  const env = testEnv({ DATABASE_URL: 'postgresql://galaxy_api:x@127.0.0.1:1/postgres' });
  const db = createDb(env.DATABASE_URL);
  const app = await buildApp({ env, db });
  try {
    const res = await app.inject({ method: 'GET', url: '/galaxy/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: 'down' });
  } finally {
    await app.close();
    await db.destroy();
  }
});

test('POST con Origin ajeno o sin Origin → 403 origin_rejected', async () => {
  for (const headers of [{ origin: 'https://evil.example' }, {}]) {
    const res = await ctx.app.inject({ method: 'POST', url: '/galaxy/api/_test', headers });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'origin_rejected' });
  }
});

test('POST con Origin permitido pasa', async () => {
  const res = await ctx.app.inject({ method: 'POST', url: '/galaxy/api/_test', headers: { origin: ORIGIN } });
  expect(res.statusCode).toBe(200);
});

test('una ruta de API desconocida → 404 not_found con cabeceras', async () => {
  const res = await ctx.app.inject({ method: 'GET', url: '/galaxy/api/nada' });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: 'not_found' });
  expect(res.headers['content-security-policy']).toBe(CSP);
});
