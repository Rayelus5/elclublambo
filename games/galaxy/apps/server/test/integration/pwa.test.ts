import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { testApp } from '../helpers';

// The installable app on the real server (galaxysurvivor.es plan, PR 3): the worker at /galaxy/sw.js, revalidated on
// every check and switched off by GALAXY_PWA=off; the manifest and the icons with their own types. A missing file of
// the app is a 404, never the HTML shell with a 200 (the browser would take the page for a manifest or a worker).

const INDEX = '<!doctype html><html lang="es"><head><title>Galaxy Survivor</title><!--gs:head--></head><body><div id="root"></div></body></html>';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
let dir: string;
let on: Awaited<ReturnType<typeof testApp>>;
let off: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'galaxy-pwa-'));
  mkdirSync(join(dir, 'icons'));
  writeFileSync(join(dir, 'index.html'), INDEX);
  writeFileSync(join(dir, 'manifest.webmanifest'), JSON.stringify({ name: 'Galaxy Survivor', start_url: '/galaxy/' }));
  writeFileSync(join(dir, 'offline.html'), '<!doctype html><title>Sin conexión</title>');
  writeFileSync(join(dir, 'offline.css'), 'body{}');
  writeFileSync(join(dir, 'icons', 'icon-192.png'), PNG);
  writeFileSync(join(dir, 'icons', 'shot-horde.webp'), 'RIFF');
  on = await testApp({ env: { WEB_DIST: dir } });
  off = await testApp({ env: { WEB_DIST: dir, GALAXY_PWA: false } });
});
afterAll(async () => {
  await on.close();
  await off.close();
  rmSync(dir, { recursive: true, force: true });
});

test('/galaxy/sw.js es JavaScript sin caché, con la red primero y la página offline', async () => {
  const res = await on.app.inject({ method: 'GET', url: '/galaxy/sw.js' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
  expect(res.headers['cache-control']).toBe('no-cache');
  expect(res.body).toContain("'/galaxy/offline.html'".replaceAll("'", '"'));
  expect(res.body).toContain("addEventListener('fetch'");
  expect(res.body).not.toContain('unregister');
});

test('con GALAXY_PWA=off, /galaxy/sw.js es el interruptor de apagado y el shell no lleva manifest', async () => {
  const res = await off.app.inject({ method: 'GET', url: '/galaxy/sw.js' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
  expect(res.headers['cache-control']).toBe('no-cache');
  expect(res.body).toContain('self.registration.unregister()');
  expect(res.body).not.toContain("addEventListener('fetch'");
  const shell = await off.app.inject({ method: 'GET', url: '/galaxy/' });
  expect(shell.body).not.toContain('rel="manifest"');
  expect((await on.app.inject({ method: 'GET', url: '/galaxy/' })).body).toContain('<link rel="manifest" href="/galaxy/manifest.webmanifest">');
});

test('el manifest, la página offline y los iconos llevan su tipo, sin caché larga', async () => {
  const cases = [
    ['/galaxy/manifest.webmanifest', 'application/manifest+json'],
    ['/galaxy/offline.html', 'text/html; charset=utf-8'],
    ['/galaxy/offline.css', 'text/css; charset=utf-8'],
    ['/galaxy/icons/icon-192.png', 'image/png'],
    ['/galaxy/icons/shot-horde.webp', 'image/webp'],
  ] as const;
  for (const [url, type] of cases) {
    const res = await on.app.inject({ method: 'GET', url });
    expect(res.statusCode, url).toBe(200);
    expect(res.headers['content-type'], url).toBe(type);
    expect(res.headers['cache-control'], url).toBe('no-cache');
  }
});

test('un archivo que falta es un 404, nunca el shell con un 200', async () => {
  const bare = mkdtempSync(join(tmpdir(), 'galaxy-pwa-bare-'));
  writeFileSync(join(bare, 'index.html'), INDEX);
  const app = await testApp({ env: { WEB_DIST: bare } });
  try {
    for (const url of ['/galaxy/manifest.webmanifest', '/galaxy/offline.html', '/galaxy/icons/icon-512.png', '/galaxy/robots.txt', '/galaxy/nada.js']) {
      const res = await app.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type'], url).not.toMatch(/text\/html/);
    }
    // The routes of the web still get the shell, and so does /galaxy/index.html.
    for (const url of ['/galaxy/entrar', '/galaxy/perfil/vega', '/galaxy/index.html']) {
      const res = await app.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type'], url).toMatch(/text\/html/);
    }
  } finally {
    await app.close();
    rmSync(bare, { recursive: true, force: true });
  }
});
