import type { LiveContentView } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// The live content for the web's descriptions (plan «escáner pro», part D): what a relic does is told with the content
// published on PRE, not the one built into the web, so a retuned relic reads right without a deploy. It names its
// version as an ETag, so an unchanged one costs nothing.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

test('la configuración viva de contenido llega con su versión, y sin cambios no se vuelve a mandar', async () => {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('cnt'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const first = await get(ctx.app, '/galaxy/api/content', { cookie });
  expect(first.statusCode).toBe(200);
  const body = first.json() as LiveContentView;
  expect(body.version).toBeGreaterThanOrEqual(0);
  expect(Object.keys(body.content.relics)).toEqual(Object.keys(DEFAULT_CONTENT.relics));
  const etag = first.headers['etag'] as string;
  expect(etag).toMatch(/^"content-\d+"$/);
  expect(first.headers['cache-control']).toContain('private');
  const again = await get(ctx.app, '/galaxy/api/content', { cookie, headers: { 'if-none-match': etag } });
  expect(again.statusCode).toBe(304);
  expect((await get(ctx.app, '/galaxy/api/content')).statusCode).toBe(401);
});
